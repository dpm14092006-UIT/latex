FROM node:24-alpine
WORKDIR /app
COPY electron/lan-sync-transport.cjs electron/sync-relay-server.cjs ./electron/
USER node
EXPOSE 8787
ENV RELAY_BIND=0.0.0.0 PORT=8787
CMD ["node", "electron/sync-relay-server.cjs"]
