package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"vietlatex-studio/backend/internal/service"
)

func main() {
	listenAddress := flag.String("listen", "127.0.0.1:4317", "loopback address for the local API")
	flag.Parse()

	token := os.Getenv("VIETLATEX_API_TOKEN")
	if len(token) < 32 {
		log.Fatal("VIETLATEX_API_TOKEN must contain at least 32 characters")
	}

	listener, err := net.Listen("tcp", *listenAddress)
	if err != nil {
		log.Fatalf("cannot listen on %s: %v", *listenAddress, err)
	}
	if tcpAddress, ok := listener.Addr().(*net.TCPAddr); !ok || !tcpAddress.IP.IsLoopback() {
		_ = listener.Close()
		log.Fatal("the backend only accepts loopback addresses")
	}

	api := service.New(token)
	server := &http.Server{
		Handler:           api.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	api.Start()
	serveResult := make(chan error, 1)
	go func() { serveResult <- server.Serve(listener) }()

	address := listener.Addr().String()
	if err := json.NewEncoder(os.Stdout).Encode(map[string]string{"event": "ready", "address": address}); err != nil {
		log.Fatalf("cannot announce readiness: %v", err)
	}

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(shutdownSignal)

	select {
	case signalValue := <-shutdownSignal:
		log.Printf("received %s; stopping backend", signalValue)
	case <-api.ShutdownRequested():
		log.Print("received local shutdown request")
	case serveErr := <-serveResult:
		if serveErr != nil && serveErr != http.ErrServerClosed {
			log.Printf("HTTP server stopped: %v", serveErr)
			os.Exit(1)
		}
		return
	}

	api.CancelActiveCompiles()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown timed out: %v", err)
		_ = server.Close()
	}
	if err := <-serveResult; err != nil && err != http.ErrServerClosed {
		log.Printf("HTTP server stopped: %v", err)
	}
	log.Print("Go backend stopped")
}
