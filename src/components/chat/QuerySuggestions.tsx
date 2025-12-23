import { Sparkles, TrendingUp, BarChart3, PieChart, Calendar, Users } from "lucide-react";

interface QuerySuggestionsProps {
  dataContext?: {
    hasNumericColumns: boolean;
    hasDateColumns: boolean;
    hasCategoricalColumns: boolean;
    columns: string[];
    rowCount: number;
  };
  onSelectQuery: (query: string) => void;
  recentQueries?: string[];
}

export function QuerySuggestions({ dataContext, onSelectQuery, recentQueries }: QuerySuggestionsProps) {
  // Smart suggestions based on data context
  const smartSuggestions = dataContext ? [
    ...(dataContext.hasNumericColumns ? [
      { icon: <TrendingUp className="w-4 h-4" />, text: "Show summary statistics", color: "blue" },
      { icon: <BarChart3 className="w-4 h-4" />, text: "Create a distribution chart", color: "green" },
    ] : []),
    ...(dataContext.hasDateColumns ? [
      { icon: <Calendar className="w-4 h-4" />, text: "Analyze trends over time", color: "purple" },
    ] : []),
    ...(dataContext.hasCategoricalColumns ? [
      { icon: <PieChart className="w-4 h-4" />, text: "Compare by category", color: "orange" },
    ] : []),
    { icon: <Users className="w-4 h-4" />, text: "Find correlations between columns", color: "pink" },
  ] : [];

  // General helpful queries
  const generalSuggestions = [
    { icon: <Sparkles className="w-4 h-4" />, text: "What are the key insights?", color: "blue" },
    { icon: <BarChart3 className="w-4 h-4" />, text: "Show me the top 10 records", color: "green" },
    { icon: <TrendingUp className="w-4 h-4" />, text: "Find outliers and anomalies", color: "red" },
    { icon: <PieChart className="w-4 h-4" />, text: "Create a summary dashboard", color: "purple" },
  ];

  const suggestions = smartSuggestions.length > 0 ? smartSuggestions : generalSuggestions;

  const getColorClasses = (color: string) => {
    const colors: Record<string, string> = {
      blue: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30",
      green: "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30",
      purple: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30",
      orange: "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30",
      pink: "bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800 hover:bg-pink-100 dark:hover:bg-pink-900/30",
      red: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30",
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="mb-4">
      {/* Recent Queries */}
      {recentQueries && recentQueries.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Recent
          </h4>
          <div className="flex flex-wrap gap-2">
            {recentQueries.slice(0, 3).map((query, idx) => (
              <button
                key={idx}
                onClick={() => onSelectQuery(query)}
                className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors truncate max-w-xs"
              >
                {query}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Smart Suggestions */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          {dataContext ? 'Smart Suggestions' : 'Try These'}
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {suggestions.map((suggestion, idx) => (
            <button
              key={idx}
              onClick={() => onSelectQuery(suggestion.text)}
              className={`flex items-center gap-2 px-4 py-3 text-sm rounded-lg border transition-all ${getColorClasses(suggestion.color)}`}
            >
              {suggestion.icon}
              <span className="font-medium">{suggestion.text}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Context hint */}
      {dataContext && (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          💡 Analyzing {dataContext.rowCount.toLocaleString()} rows × {dataContext.columns.length} columns
        </div>
      )}
    </div>
  );
}
