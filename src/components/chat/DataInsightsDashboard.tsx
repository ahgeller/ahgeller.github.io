import { useMemo } from "react";
import { TrendingUp, AlertCircle, CheckCircle, Database, BarChart3, Table } from "lucide-react";

interface DataInsightsDashboardProps {
  data: any[];
  fileName?: string;
}

export function DataInsightsDashboard({ data, fileName }: DataInsightsDashboardProps) {
  const insights = useMemo(() => {
    if (!data || data.length === 0) return null;

    const firstRow = data[0];
    const columns = Object.keys(firstRow);
    
    // Calculate basic statistics
    const rowCount = data.length;
    const columnCount = columns.length;
    
    // Detect column types and quality
    const columnStats = columns.map(col => {
      const values = data.map(row => row[col]);
      const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');
      const uniqueValues = new Set(nonNullValues);
      
      // Detect type
      const isNumeric = nonNullValues.every(v => !isNaN(Number(v)));
      const isDate = nonNullValues.some(v => !isNaN(Date.parse(v)));
      
      return {
        name: col,
        type: isNumeric ? 'numeric' : isDate ? 'date' : 'text',
        nullCount: rowCount - nonNullValues.length,
        uniqueCount: uniqueValues.size,
        completeness: (nonNullValues.length / rowCount) * 100,
        cardinality: (uniqueValues.size / rowCount) * 100
      };
    });
    
    // Find potential issues
    const issues = [];
    const highNullColumns = columnStats.filter(c => c.completeness < 50);
    if (highNullColumns.length > 0) {
      issues.push({
        type: 'warning',
        message: `${highNullColumns.length} column${highNullColumns.length > 1 ? 's have' : ' has'} >50% missing values`,
        columns: highNullColumns.map(c => c.name)
      });
    }
    
    const duplicateRows = data.length - new Set(data.map(r => JSON.stringify(r))).size;
    if (duplicateRows > 0) {
      issues.push({
        type: 'info',
        message: `${duplicateRows} duplicate row${duplicateRows > 1 ? 's' : ''} detected`
      });
    }
    
    // Find interesting patterns
    const patterns = [];
    const numericColumns = columnStats.filter(c => c.type === 'numeric');
    if (numericColumns.length > 0) {
      patterns.push({
        icon: <TrendingUp className="w-4 h-4" />,
        message: `${numericColumns.length} numeric column${numericColumns.length > 1 ? 's' : ''} available for analysis`
      });
    }
    
    const dateColumns = columnStats.filter(c => c.type === 'date');
    if (dateColumns.length > 0) {
      patterns.push({
        icon: <BarChart3 className="w-4 h-4" />,
        message: `Time-series analysis possible with ${dateColumns.length} date column${dateColumns.length > 1 ? 's' : ''}`
      });
    }
    
    const categoricalColumns = columnStats.filter(c => c.type === 'text' && c.cardinality < 10);
    if (categoricalColumns.length > 0) {
      patterns.push({
        icon: <Table className="w-4 h-4" />,
        message: `${categoricalColumns.length} categorical column${categoricalColumns.length > 1 ? 's' : ''} ideal for grouping`
      });
    }
    
    return {
      rowCount,
      columnCount,
      columnStats,
      issues,
      patterns,
      dataQualityScore: Math.round(
        columnStats.reduce((sum, c) => sum + c.completeness, 0) / columnCount
      )
    };
  }, [data]);

  if (!insights) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 mb-4">
        <p className="text-gray-500 dark:text-gray-400">No data to analyze</p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 rounded-lg p-6 mb-4 border border-blue-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          Data Insights
          {fileName && <span className="text-sm font-normal text-gray-600 dark:text-gray-400">• {fileName}</span>}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Quality Score:</span>
          <span className={`text-lg font-bold ${
            insights.dataQualityScore >= 90 ? 'text-green-600' :
            insights.dataQualityScore >= 70 ? 'text-yellow-600' :
            'text-red-600'
          }`}>
            {insights.dataQualityScore}%
          </span>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {insights.rowCount.toLocaleString()}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Rows</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {insights.columnCount}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Columns</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {insights.columnStats.filter(c => c.type === 'numeric').length}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Numeric</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {insights.issues.length}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Issues</div>
        </div>
      </div>

      {/* Issues */}
      {insights.issues.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Data Quality Issues</h4>
          <div className="space-y-2">
            {insights.issues.map((issue, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 p-3 rounded-lg ${
                  issue.type === 'warning'
                    ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200'
                    : 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200'
                }`}
              >
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{issue.message}</p>
                  {issue.columns && (
                    <p className="text-xs mt-1 opacity-80">
                      Columns: {issue.columns.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patterns */}
      {insights.patterns.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Analysis Opportunities</h4>
          <div className="space-y-2">
            {insights.patterns.map((pattern, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-3 rounded-lg bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200"
              >
                {pattern.icon}
                <p className="text-sm font-medium">{pattern.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggested Queries */}
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">💡 Try These Queries:</h4>
        <div className="flex flex-wrap gap-2">
          {insights.columnStats.filter(c => c.type === 'numeric').slice(0, 2).map(col => (
            <button
              key={col.name}
              className="px-3 py-1 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Show distribution of {col.name}
            </button>
          ))}
          {insights.columnStats.filter(c => c.type === 'text' && c.cardinality < 10).slice(0, 1).map(col => (
            <button
              key={col.name}
              className="px-3 py-1 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Compare by {col.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
