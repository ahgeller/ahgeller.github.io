# Data Analytics AI

An intelligent data analysis assistant built with React, TypeScript, and AI. Upload CSV files, ask questions in natural language, and get instant insights with visualizations powered by AI.

## Features

### AI-Powered Analysis
- Natural language queries - ask questions about your data in plain English
- Multiple AI model support via OpenRouter (Devstral, Grok, Qwen, DeepSeek, and more)
- Custom model configuration
- Smart followup handling for complex multi-step analysis

### Data Visualization
- Interactive charts powered by ECharts (bar, line, pie, scatter, heatmap, and more)
- Auto-generated visualizations based on your questions
- Customizable chart configurations

### Data Management
- CSV file upload and analysis
- In-browser SQL queries with DuckDB-WASM
- Filter and group data by columns
- Support for large datasets with efficient querying

### 🔧 Advanced Features
- Code execution sandbox for custom JavaScript/SQL queries
- Multi-file dataset analysis
- Persistent chat history
- Markdown rendering with LaTeX math support
- Syntax highlighting for code blocks

## Tech Stack

- **Frontend**: React 18, TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Database**: DuckDB-WASM (in-browser SQL)
- **Charts**: ECharts
- **AI**: OpenRouter API (multiple model support)
- **State Management**: Zustand

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- OpenRouter API key ([Get one here](https://openrouter.ai/settings/keys))

### Installation

1. Clone the repository:
```bash
git clone https://github.com/ahgeller/ahgeller.github.io.git
cd ahgeller.github.io
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser to `http://localhost:5173`

### Configuration

1. Click the settings icon in the app
2. Add your OpenRouter API key
3. Select your preferred AI model
4. (Optional) Add custom models or configure other API providers

## Usage

### Analyzing CSV Data

1. Click "Upload CSV" or drag and drop a CSV file
2. Select the dataset you want to analyze
3. Ask questions like:
   - "What are the top 10 values by score?"
   - "Show me a chart of trends over time"
   - "Calculate the correlation between X and Y"
   - "Group by category and show average values"

### Writing Custom Queries

The AI can execute custom SQL queries on your data:

```sql
SELECT column_name, COUNT(*) as count
FROM csvData
GROUP BY column_name
ORDER BY count DESC
LIMIT 10
```

## Deployment

Build for production:

```bash
npm run build
```

The built files will be in the `dist` directory, ready to deploy to GitHub Pages or any static hosting service.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.
