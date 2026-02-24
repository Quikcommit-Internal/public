# Installation

## npm

```bash
npm install -g @quikcommit/cli
```

## Homebrew

```bash
brew install quikcommit/tap/quikcommit
```

## Binary Download

Download the standalone binary for your platform from [GitHub Releases](https://github.com/Quikcommit-Internal/public/releases):

- **macOS (Apple Silicon):** `qc-darwin-arm64`
- **macOS (Intel):** `qc-darwin-x64`
- **Linux (x64):** `qc-linux-x64`
- **Linux (ARM64):** `qc-linux-arm64`

Place the binary in your PATH and make it executable:

```bash
chmod +x qc-darwin-arm64
mv qc-darwin-arm64 /usr/local/bin/qc
```

## curl (Linux/macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/Quikcommit-Internal/public/main/install.sh | sh
```

## Verify

```bash
qc --help
```
