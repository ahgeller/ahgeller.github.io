import { useState } from "react";
import { formatForFilename, formatForExport } from "@/lib/dateFormatter";
import { X, Download, FileText, Image, Table, Code } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  chatHistory: any[];
  charts: any[];
  chatTitle?: string;
}

type ExportFormat = 'pdf' | 'html' | 'markdown' | 'json' | 'csv';

export function ExportDialog({ isOpen, onClose, chatHistory, charts, chatTitle }: ExportDialogProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('html');
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeCode, setIncludeCode] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const { theme } = useTheme();

  const formats = [
    { 
      id: 'html' as ExportFormat, 
      name: 'HTML Report', 
      icon: <FileText className="w-5 h-5" />, 
      description: 'Interactive web page with all content' 
    },
    { 
      id: 'pdf' as ExportFormat, 
      name: 'PDF Document', 
      icon: <FileText className="w-5 h-5" />, 
      description: 'Print-ready document (requires browser print)' 
    },
    { 
      id: 'markdown' as ExportFormat, 
      name: 'Markdown', 
      icon: <Code className="w-5 h-5" />, 
      description: 'Text format for documentation' 
    },
    { 
      id: 'json' as ExportFormat, 
      name: 'JSON Data', 
      icon: <Code className="w-5 h-5" />, 
      description: 'Raw data for further processing' 
    },
    { 
      id: 'csv' as ExportFormat, 
      name: 'CSV Export', 
      icon: <Table className="w-5 h-5" />, 
      description: 'Spreadsheet-compatible format' 
    },
  ];

  // Helper function to escape HTML special characters and prevent XSS attacks
  const escapeHtml = (text: string): string => {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Convert markdown-like content to HTML with proper formatting
  const formatMessageContent = (content: string): string => {
    if (!content) return '';

    let html = '';
    const lines = content.split('\n');
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Handle code blocks
      if (line.trim().startsWith('```')) {
        if (!inCodeBlock) {
          // Starting code block
          inCodeBlock = true;
          codeLanguage = line.trim().substring(3);
          codeLines = [];
        } else {
          // Ending code block
          inCodeBlock = false;
          html += `<div class="code"><pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></div>`;
          codeLines = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      // Handle headings
      if (line.startsWith('### ')) {
        html += `<h3>${escapeHtml(line.substring(4))}</h3>`;
      } else if (line.startsWith('## ')) {
        html += `<h2>${escapeHtml(line.substring(3))}</h2>`;
      } else if (line.startsWith('# ')) {
        html += `<h1>${escapeHtml(line.substring(2))}</h1>`;
      }
      // Handle bold
      else if (line.includes('**')) {
        let formatted = escapeHtml(line);
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html += `<p>${formatted}</p>`;
      }
      // Handle inline code
      else if (line.includes('`')) {
        let formatted = escapeHtml(line);
        formatted = formatted.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px; font-family: monospace;">$1</code>');
        html += `<p>${formatted}</p>`;
      }
      // Regular text
      else if (line.trim()) {
        html += `<p>${escapeHtml(line)}</p>`;
      }
      // Empty line = spacing
      else {
        html += '<br>';
      }
    }

    return html;
  };

  // Convert chart canvas to base64 image
  const getChartImage = async (chartId: string): Promise<string | null> => {
    try {
      const canvas = document.querySelector(`canvas[data-chart-id="${chartId}"]`) as HTMLCanvasElement;
      if (!canvas) {
        // Try finding any canvas in the chart container
        const chartContainer = document.querySelector(`[data-chart-id="${chartId}"]`);
        const canvasInContainer = chartContainer?.querySelector('canvas') as HTMLCanvasElement;
        if (canvasInContainer) {
          return canvasInContainer.toDataURL('image/png');
        }
        return null;
      }
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Failed to get chart image:', error);
      return null;
    }
  };

  const handleExport = async () => {
    setIsExporting(true);

    try {
      let content = '';
      let filename = `${chatTitle || 'analysis'}-${formatForFilename(Date.now())}`;
      let mimeType = 'text/plain';

      switch (selectedFormat) {
        case 'html':
          content = await generateHTMLReport();
          filename += '.html';
          mimeType = 'text/html';
          break;
        case 'markdown':
          content = generateMarkdownReport();
          filename += '.md';
          mimeType = 'text/markdown';
          break;
        case 'json':
          content = JSON.stringify({ chatHistory, charts, exportDate: formatForExport(Date.now()) }, null, 2);
          filename += '.json';
          mimeType = 'application/json';
          break;
        case 'csv':
          content = generateCSVReport();
          filename += '.csv';
          mimeType = 'text/csv';
          break;
        case 'pdf':
          // For PDF, we'll open print dialog with HTML content
          const printWindow = window.open('', '_blank');
          if (printWindow) {
            const htmlContent = await generateHTMLReport();
            printWindow.document.write(htmlContent);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 500);
          }
          setIsExporting(false);
          onClose();
          return;
      }

      // Download the file
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setIsExporting(false);
      onClose();
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
      setIsExporting(false);
    }
  };

  const generateHTMLReport = async () => {
    const title = chatTitle || 'Data Analysis Report';
    const date = new Date().toLocaleDateString();

    // Get chart images
    const chartImages: Record<string, string | null> = {};
    if (includeCharts && charts.length > 0) {
      for (const chart of charts) {
        const image = await getChartImage(chart.id);
        if (image) {
          chartImages[chart.id] = image;
        }
      }
    }
    
    // Detect if dark mode is active
    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    // Theme-aware colors
    const colors = isDark ? {
      bg: '#111827',
      text: '#f9fafb',
      heading: '#60a5fa',
      headingBorder: '#3b82f6',
      userBg: '#1e3a8a',
      userBorder: '#3b82f6',
      assistantBg: '#1f2937',
      assistantBorder: '#6b7280',
      codeBg: '#0f172a',
      codeText: '#f1f5f9',
      chartBg: '#1f2937',
      meta: '#9ca3af',
      hrBorder: '#374151'
    } : {
      bg: '#ffffff',
      text: '#333333',
      heading: '#2563eb',
      headingBorder: '#2563eb',
      userBg: '#eff6ff',
      userBorder: '#2563eb',
      assistantBg: '#f9fafb',
      assistantBorder: '#6b7280',
      codeBg: '#1f2937',
      codeText: '#f9fafb',
      chartBg: '#f9fafb',
      meta: '#6b7280',
      hrBorder: '#e5e7eb'
    };
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      background-color: ${colors.bg};
      color: ${colors.text};
    }
    h1 { color: ${colors.heading}; border-bottom: 3px solid ${colors.headingBorder}; padding-bottom: 10px; margin-top: 0; }
    h2 { color: ${colors.heading}; margin-top: 30px; margin-bottom: 15px; font-size: 1.5rem; }
    h3 { color: ${colors.heading}; margin-top: 20px; margin-bottom: 10px; font-size: 1.25rem; }
    .message { margin: 20px 0; padding: 15px; border-radius: 8px; }
    .message p { margin: 8px 0; line-height: 1.6; }
    .message br { display: block; margin: 8px 0; content: ""; }
    .user { background: ${colors.userBg}; border-left: 4px solid ${colors.userBorder}; }
    .assistant { background: ${colors.assistantBg}; border-left: 4px solid ${colors.assistantBorder}; }
    .code { background: ${colors.codeBg}; color: ${colors.codeText}; padding: 15px; border-radius: 8px; overflow-x: auto; margin: 12px 0; font-size: 0.9rem; }
    .chart { margin: 20px 0; padding: 20px; background: ${colors.chartBg}; border-radius: 8px; text-align: center; }
    .meta { color: ${colors.meta}; font-size: 0.875rem; }
    pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; font-family: 'Consolas', 'Monaco', 'Courier New', monospace; }
    code { font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 0.9em; }
    strong { font-weight: 600; color: ${colors.heading}; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated on ${escapeHtml(date)}</p>
  
  <h2>Conversation</h2>
  ${chatHistory.map(msg => `
    <div class="message ${msg.role}">
      <strong>${msg.role === 'user' ? 'You' : 'AI Assistant'}:</strong>
      <div>${formatMessageContent(msg.content)}</div>
      ${includeCode && msg.code ? `<div class="code"><pre><code>${escapeHtml(msg.code)}</code></pre></div>` : ''}
    </div>
  `).join('')}

  ${includeCharts && charts.length > 0 ? `
    <h2>Visualizations</h2>
    ${charts.map((chart, idx) => {
      const image = chartImages[chart.id];
      return `
        <div class="chart">
          <h3>Chart ${idx + 1}: ${escapeHtml(chart.type || 'Visualization')}</h3>
          <p class="meta">Created at ${new Date(chart.timestamp).toLocaleString()}</p>
          ${image ? `<img src="${image}" alt="Chart ${idx + 1}" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">` : '<p><em>Chart image not available</em></p>'}
        </div>
      `;
    }).join('')}
  ` : ''}
  
  <hr style="margin-top: 40px; border: none; border-top: 1px solid ${colors.hrBorder};">
  <p class="meta" style="text-align: center;">
    Report generated by Data Analyst Chat • ${new Date().toISOString()}
  </p>
</body>
</html>`;
  };

  const generateMarkdownReport = () => {
    const title = chatTitle || 'Data Analysis Report';
    const date = new Date().toLocaleDateString();
    
    let md = `# ${title}\n\n`;
    md += `*Generated on ${date}*\n\n`;
    md += `---\n\n`;
    md += `## Conversation\n\n`;
    
    chatHistory.forEach(msg => {
      md += `### ${msg.role === 'user' ? 'You' : 'AI Assistant'}\n\n`;
      md += `${msg.content}\n\n`;
      if (includeCode && msg.code) {
        md += `\`\`\`\n${msg.code}\n\`\`\`\n\n`;
      }
    });
    
    if (includeCharts && charts.length > 0) {
      md += `## Visualizations\n\n`;
      charts.forEach((chart, idx) => {
        md += `### Chart ${idx + 1}: ${chart.type}\n\n`;
        md += `*Created at ${new Date(chart.timestamp).toLocaleString()}*\n\n`;
      });
    }
    
    md += `---\n\n`;
    md += `*Report generated by Data Analyst Chat*\n`;
    
    return md;
  };

  const generateCSVReport = () => {
    // Export conversation as CSV
    let csv = 'Role,Content,Timestamp\n';
    chatHistory.forEach(msg => {
      const content = msg.content.replace(/"/g, '""'); // Escape quotes
      csv += `"${msg.role}","${content}","${new Date(msg.timestamp || Date.now()).toISOString()}"\n`;
    });
    return csv;
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Download className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Export Analysis
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Format Selection */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Export Format
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {formats.map((format) => (
                <button
                  key={format.id}
                  onClick={() => setSelectedFormat(format.id)}
                  className={`flex items-start gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                    selectedFormat === format.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className={selectedFormat === format.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}>
                    {format.icon}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900 dark:text-white mb-1">
                      {format.name}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {format.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Include
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCharts}
                  onChange={(e) => setIncludeCharts(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    Charts & Visualizations
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Include all generated charts
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCode}
                  onChange={(e) => setIncludeCode(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    Code Blocks
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Include generated code snippets
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <strong>Export Summary:</strong>
              <ul className="mt-2 space-y-1 ml-4 list-disc">
                <li>{chatHistory.length} messages</li>
                {includeCharts && <li>{charts.length} charts</li>}
                <li>Format: {formats.find(f => f.id === selectedFormat)?.name}</li>
              </ul>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
            >
              <Download className="w-5 h-5" />
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
            <button
              onClick={onClose}
              className="px-6 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
