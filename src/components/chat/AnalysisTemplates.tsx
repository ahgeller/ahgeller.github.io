import { useState } from "react";
import { Sparkles, TrendingUp, BarChart3, PieChart, Activity, Target, Zap } from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  queries: string[];
  color: string;
}

const templates: Template[] = [
  {
    id: 'quick-overview',
    name: 'Quick Overview',
    description: 'Get a rapid summary of your data',
    icon: <Zap className="w-5 h-5" />,
    category: 'Getting Started',
    queries: [
      'Show me a summary of this dataset',
      'What are the column types and data quality?',
      'Display the first 10 rows',
    ],
    color: 'blue'
  },
  {
    id: 'trend-analysis',
    name: 'Trend Analysis',
    description: 'Identify patterns over time (requires date column)',
    icon: <TrendingUp className="w-5 h-5" />,
    category: 'Time Series',
    queries: [
      'Show trends over time for key metrics',
      'Identify any seasonal patterns',
      'Compare performance period-over-period',
      'Forecast next period based on historical data',
    ],
    color: 'green'
  },
  {
    id: 'distribution-analysis',
    name: 'Distribution Analysis',
    description: 'Understand data spread and outliers',
    icon: <BarChart3 className="w-5 h-5" />,
    category: 'Statistical',
    queries: [
      'Show distribution of all numeric columns',
      'Find outliers and anomalies in the data',
      'Display histogram for each numeric column',
      'Calculate percentiles and quartiles',
    ],
    color: 'purple'
  },
  {
    id: 'comparison-analysis',
    name: 'Comparison Analysis',
    description: 'Compare groups and categories',
    icon: <PieChart className="w-5 h-5" />,
    category: 'Comparative',
    queries: [
      'Compare values across different categories',
      'Show top and bottom performers',
      'Create side-by-side comparisons',
      'Identify significant differences between groups',
    ],
    color: 'orange'
  },
  {
    id: 'correlation-analysis',
    name: 'Correlation Analysis',
    description: 'Find relationships between variables',
    icon: <Activity className="w-5 h-5" />,
    category: 'Statistical',
    queries: [
      'Find correlations between numeric columns',
      'Show scatter plots for key relationships',
      'Identify which factors influence the outcome',
      'Create a correlation matrix',
    ],
    color: 'pink'
  },
  {
    id: 'data-quality',
    name: 'Data Quality Check',
    description: 'Identify data issues and completeness',
    icon: <Target className="w-5 h-5" />,
    category: 'Data Quality',
    queries: [
      'Check for missing values in each column',
      'Identify duplicate records',
      'Find inconsistent data formats',
      'Show data completeness report',
    ],
    color: 'red'
  },
];

interface AnalysisTemplatesProps {
  onSelectTemplate: (template: Template) => void;
  onSelectQuery: (query: string) => void;
}

export function AnalysisTemplates({ onSelectTemplate, onSelectQuery }: AnalysisTemplatesProps) {
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  const getColorClasses = (color: string) => {
    const colors: Record<string, string> = {
      blue: "from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700",
      green: "from-green-500 to-green-600 hover:from-green-600 hover:to-green-700",
      purple: "from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700",
      orange: "from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700",
      pink: "from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700",
      red: "from-red-500 to-red-600 hover:from-red-600 hover:to-red-700",
    };
    return colors[color] || colors.blue;
  };

  const categories = [...new Set(templates.map(t => t.category))];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
          Analysis Templates
        </h3>
      </div>

      {categories.map((category) => (
        <div key={category}>
          <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {category}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates
              .filter((t) => t.category === category)
              .map((template) => (
                <div
                  key={template.id}
                  className="group relative bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition-all"
                >
                  {/* Template Header */}
                  <button
                    onClick={() => setExpandedTemplate(
                      expandedTemplate === template.id ? null : template.id
                    )}
                    className="w-full text-left"
                  >
                    <div className={`bg-gradient-to-r ${getColorClasses(template.color)} p-4 text-white`}>
                      <div className="flex items-center gap-3 mb-2">
                        {template.icon}
                        <h4 className="font-bold">{template.name}</h4>
                      </div>
                      <p className="text-sm text-white/90">
                        {template.description}
                      </p>
                    </div>
                  </button>

                  {/* Queries */}
                  {expandedTemplate === template.id && (
                    <div className="p-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 animate-in slide-in-from-top-2 duration-200">
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-2">
                        Included Queries:
                      </p>
                      <div className="space-y-2">
                        {template.queries.map((query, idx) => (
                          <button
                            key={idx}
                            onClick={() => onSelectQuery(query)}
                            className="w-full text-left px-3 py-2 text-sm bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-600 transition-colors"
                          >
                            {idx + 1}. {query}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => onSelectTemplate(template)}
                        className="w-full mt-3 px-4 py-2 bg-gray-900 dark:bg-gray-700 hover:bg-gray-800 dark:hover:bg-gray-600 text-white font-medium rounded transition-colors"
                      >
                        Run Full Template
                      </button>
                    </div>
                  )}

                  {/* Quick Action when collapsed */}
                  {expandedTemplate !== template.id && (
                    <div className="p-3 flex items-center justify-between">
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {template.queries.length} queries
                      </span>
                      <button
                        onClick={() => onSelectTemplate(template)}
                        className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors"
                      >
                        Quick Run
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
