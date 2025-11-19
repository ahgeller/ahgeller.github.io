# Data Analytics AI

A powerful AI-powered data analysis application built with React, TypeScript, and Vite.

## Features

- 🤖 Multiple AI model support (OpenRouter, OpenAI, Anthropic, etc.)
- 📊 Interactive data analysis with code execution
- 📁 CSV file upload and analysis
- 🗄️ Database integration for querying data
- 💬 Chat interface with conversation history
- 🎨 Customizable themes
- 📈 Chart rendering and visualization

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/ahgeller/VolleyBall.git
cd VolleyBall
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:8080`

## Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Deployment

This project is configured for GitHub Pages deployment. The GitHub Actions workflow will automatically build and deploy the site when you push to the `main` branch.

### Manual Deployment

1. Build the project:
```bash
npm run build
```

2. The `dist` folder contains the production-ready files that can be deployed to any static hosting service.

## Configuration

### API Keys

Add your API keys in the Settings page:
- OpenRouter API key
- OpenAI API key (optional)
- Anthropic API key (optional)
- Other provider API keys as needed

### Database Connection

Configure your database connection string in the Database Settings page.

## Project Structure

```
src/
├── components/     # React components
├── lib/            # Utility functions and API clients
├── pages/          # Page components
├── types/          # TypeScript type definitions
└── hooks/          # Custom React hooks
```

## Technologies Used

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Radix UI
- Recharts
- React Markdown

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

