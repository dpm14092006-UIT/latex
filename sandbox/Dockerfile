FROM debian:bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends texlive-xetex texlive-latex-extra texlive-bibtex-extra biber texlive-fonts-recommended texlive-lang-other lmodern && rm -rf /var/lib/apt/lists/*
WORKDIR /work
CMD ["xelatex", "--version"]
