# Sidestream

**The free, open-source, cross-platform, cross-model AI chat app with a side dish of insights.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-15+-black?logo=apple)](https://sidestream-app.com)
[![Windows](https://img.shields.io/badge/Windows-11+-0078D6?logo=windows)](https://sidestream-app.com)
[![Linux](https://img.shields.io/badge/Linux-.deb%20|%20.rpm%20|%20AppImage-FCC624?logo=linux&logoColor=black)](https://sidestream-app.com)

![Sidestream Screenshot](screenshot.png)

## Features

- **Multiple AI Models** - Choose from Anthropic, OpenAI, and Gemini's latest models, even without a subscription
- **Bring Your Own API Key** - This app is free, just pay the AI providers directly for what you use
- **Discoveries Panel** - Chimes in with interesting, useful, amusing, and critical information that wouldn't have surfaced in your chat otherwise
- **Fork Conversations** - Branch off into new directions from any point
- **Voice Input** - Just talk if you don't feel like typing (requires either OpenAI or Google Gemini API key)
- **Cross-Platform** - Native apps for macOS, Windows, and Linux

## Download

Get the latest version for your platform at **[sidestream-app.com](https://sidestream-app.com)**

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Rust](https://rustup.rs/) (latest stable)
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  - **Linux**: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev`

### Build Steps

```bash
# Clone the repository
git clone https://github.com/ericbrandon/sidestream.git
cd sidestream

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

## Configuration

Sidestream requires API keys for the AI providers you want to use. On first launch, open Settings and enter your API keys:

- **Anthropic** - Get your key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- **OpenAI** - Get your key at [platform.openai.com/settings/organization/api-keys](https://platform.openai.com/settings/organization/api-keys)
- **Google Gemini** - Get your key at [aistudio.google.com/app/api-keys](https://aistudio.google.com/app/api-keys)

API keys are stored securely in your system's credential store.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- **Website**: [sidestream-app.com](https://sidestream-app.com)
- **Issues**: [GitHub Issues](https://github.com/ericbrandon/sidestream/issues)
- **Author**: Eric Brandon (ebrandon.developer@gmail.com)
