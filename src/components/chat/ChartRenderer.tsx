import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  LineChart, Line, 
  AreaChart, Area,
  ScatterChart, Scatter, ZAxis
} from 'recharts';
import { useMemo } from 'react';

interface ChartRendererProps {
  content: string;
  executionResults?: any;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B6B', '#4ECDC4', '#45B7D1'];

// Create a content-based hash for nested chart data objects
// This helps detect duplicates at the top level before processing
function createContentHash(data: any): string {
  try {
    if (!data || typeof data !== 'object') return '';
    
    // For nested objects with chart data (like { sideout_progression: {...}, kills_cumulative: {...} })
    // Create a hash from the actual chart data content
    const chartKeys: string[] = [];
    const chartSamples: any = {};
    
    for (const key in data) {
      const nested = data[key];
      if (nested && typeof nested === 'object') {
        // Check if it has chart data
        if (nested.x_series || nested.xSeries || 
            nested.pieData || nested.pie_data || nested.pie_chart_data ||
            nested.barData || nested.bar_chart_data || nested.barChartData ||
            nested.lineData || nested.line_chart_data || nested.lineChartData) {
          chartKeys.push(key);
          // Sample the data for hashing
          if (nested.x_series || nested.xSeries) {
            const xSeries = nested.x_series || nested.xSeries;
            chartSamples[key] = {
              type: 'x_series',
              x: Array.isArray(xSeries) ? xSeries.slice(0, 10).concat(xSeries.slice(-5)) : [],
              len: Array.isArray(xSeries) ? xSeries.length : 0
            };
          } else {
            // Sample other chart types
            const sample = JSON.stringify(nested).substring(0, 200);
            chartSamples[key] = { type: 'other', sample };
          }
        }
      }
    }
    
    if (chartKeys.length > 0) {
      return JSON.stringify({ keys: chartKeys.sort(), samples: chartSamples }).replace(/[^a-zA-Z0-9]/g, '').substring(0, 150);
    }
    
    // Fallback: hash the entire object
    return JSON.stringify(data).replace(/[^a-zA-Z0-9]/g, '').substring(0, 150);
  } catch (e) {
    return '';
  }
}

// Generate a unique key for chart data to prevent duplicates
// Uses a hash-like approach based on actual data content (not source/prefix)
function getChartDataKey(data: any, chartType: string): string {
  try {
    let dataArray: any[] = [];
    if (chartType === 'pie') {
      dataArray = data.pieData || data.pie_data || data.pie_chart_data || data.pieChartData || [];
    } else if (chartType === 'bar') {
      dataArray = data.barData || data.bar_chart_data || data.barChartData || data.histogramData || [];
    } else if (chartType === 'line') {
      dataArray = data.lineData || data.line_chart_data || data.lineChartData || [];
    } else if (chartType === 'area') {
      dataArray = data.areaData || data.area_chart_data || data.areaChartData || [];
    } else if (chartType === 'scatter') {
      dataArray = data.scatterData || data.scatter_chart_data || data.scatterChartData || [];
    }
    
    // Create a key from the actual data content (first 20 and last 10 items)
    // This makes the key independent of where the data came from
    if (Array.isArray(dataArray) && dataArray.length > 0) {
      const sample = dataArray.slice(0, 20).concat(dataArray.slice(-10));
      const dataHash = JSON.stringify(sample).replace(/[^a-zA-Z0-9]/g, '').substring(0, 100);
      return `${chartType}-${dataArray.length}-${dataHash}`;
    }
  } catch (e) {
    // Fallback to stringified data hash
  }
  // Fallback: create hash from entire data object
  const dataStr = JSON.stringify(data);
  const hash = dataStr.length + '-' + dataStr.replace(/[^a-zA-Z0-9]/g, '').substring(0, 100);
  return `${chartType}-${hash}`;
}

function processChartData(data: any, chartComponents: JSX.Element[], keyPrefix: string = '', seenCharts: Set<string> = new Set()): void {
  if (!data || typeof data !== 'object') return;
  
  // REMOVED automatic conversion of player statistics arrays to charts
  // This was too aggressive and converted informational statistics into charts
  // Charts should only be created when explicit chart data properties are present
  // (pie_data, plot_data, x_series/y_series, etc.)
  
  // Check if it's x_series/y_series chart data (line chart or bar chart)
  const xSeries = data.x_series || data.xSeries;
  const ySeries = data.y_series || data.ySeries;
  
  if (xSeries && Array.isArray(xSeries) && xSeries.length > 0) {
    // Create a more unique chart key based on actual data content (not source/prefix) to prevent duplicates
    // This ensures the same chart data structure isn't rendered multiple times from different sources
    const allYSeriesKeys = Object.keys(data)
      .filter(k => (k.endsWith('_series') || k.endsWith('Series')) && k !== 'x_series' && k !== 'xSeries')
      .sort();
    const ySeriesPreview = allYSeriesKeys.join(',');
    
    // Create a hash from the actual data values (first 20 and last 10 values of each series)
    // This makes the key independent of where the data came from (executionResults, content, etc.)
    const xSample = xSeries.slice(0, 20).concat(xSeries.slice(-10));
    const ySamples: any = {};
    allYSeriesKeys.forEach(key => {
      const series = data[key];
      if (Array.isArray(series)) {
        ySamples[key] = series.slice(0, 20).concat(series.slice(-10));
      }
    });
    // Create a stable hash from the data content
    const dataHash = JSON.stringify({ x: xSample, y: ySamples, len: xSeries.length }).replace(/[^a-zA-Z0-9]/g, '').substring(0, 100);
    const chartKey = `x_series-${xSeries.length}-${ySeriesPreview}-${dataHash}`;
    if (seenCharts.has(chartKey)) {
      return; // Skip duplicate
    }
    seenCharts.add(chartKey);
    
    // Find all y_series properties (could be multiple series like ucsd_sideout_series, nau_sideout_series)
    const ySeriesKeys: string[] = [];
    if (ySeries && Array.isArray(ySeries) && ySeries.length > 0) {
      ySeriesKeys.push('y_series');
    }
    
    // Look for other series properties (e.g., ucsd_sideout_series, nau_sideout_series, ucsd_kills_series, etc.)
    for (const key in data) {
      if (key !== 'x_series' && key !== 'xSeries' && key !== 'labels' && 
          (key.endsWith('_series') || key.endsWith('Series')) &&
          Array.isArray(data[key]) && (data[key] as any[]).length === xSeries.length) {
        ySeriesKeys.push(key);
      }
    }
    
    if (ySeriesKeys.length > 0) {
      // Determine chart type based on x_series content and number of series
      const firstXValue = xSeries[0];
      const isBarChart = (typeof firstXValue === 'string' && ySeriesKeys.length === 1) || 
                        (ySeriesKeys.length === 1 && ySeriesKeys[0] === 'y_series');
      
      if (isBarChart) {
        // Bar chart: x_series contains labels, y_series contains values
        // Get the y series data (could be y_series or another series property)
        const ySeriesKey = ySeriesKeys[0];
        const ySeriesData = ySeriesKey === 'y_series' 
          ? (data.y_series || data.ySeries || ySeries)
          : data[ySeriesKey];
        
        const chartData = xSeries.map((x: any, idx: number) => ({
          label: String(x),
          value: (Array.isArray(ySeriesData) && ySeriesData[idx] !== undefined) 
            ? (typeof ySeriesData[idx] === 'number' ? ySeriesData[idx] : parseFloat(ySeriesData[idx]) || 0)
            : 0
        }));
        
        const labels = data.labels || [];
        const yLabel = labels[1] || labels[0] || 'Value';
        
        chartComponents.push(
          <div key={`${keyPrefix}-bar-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
            <h3 className="text-lg font-semibold mb-3">
              {keyPrefix || data.title || 'Bar Chart'}
            </h3>
            <div style={{ width: '100%', height: '400px', minWidth: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="label" type="category" width={150} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="#8884d8" name={yLabel} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
        return;
      } else {
        // Line chart: x_series contains numeric values, multiple y series
        const chartData = xSeries.map((x: any, idx: number) => {
          const point: any = { x: typeof x === 'number' ? x : idx + 1 };
          ySeriesKeys.forEach(key => {
            const series = data[key];
            if (Array.isArray(series) && series[idx] !== undefined) {
              point[key] = typeof series[idx] === 'number' ? series[idx] : parseFloat(series[idx]) || 0;
            }
          });
          return point;
        });
        
        const labels = data.labels || [];
        const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00', '#0088fe', '#00c49f', '#ffbb28', '#ff8042'];
        
        chartComponents.push(
          <div key={`${keyPrefix}-line-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
            <h3 className="text-lg font-semibold mb-3">
              {keyPrefix || data.title || 'Line Chart'}
            </h3>
            <div style={{ width: '100%', height: '400px', minWidth: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="x" name={labels[0] || 'X Axis'} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {ySeriesKeys.map((key, idx) => {
                    const label = labels[idx + 1] || key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
                    return (
                      <Line 
                        key={key}
                        type="monotone" 
                        dataKey={key} 
                        stroke={colors[idx % colors.length]}
                        name={label}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
        return;
      }
    }
  }
  
  // Check if it's pie chart data (pieData, pie_data, pie_chart_data, or pieChartData)
  const pieDataArray = data.pieData || data.pie_data || data.pie_chart_data || data.pieChartData;
  if (pieDataArray && Array.isArray(pieDataArray) && pieDataArray.length > 0) {
    // Check for duplicates
    const chartKey = getChartDataKey(data, 'pie');
    if (seenCharts.has(chartKey)) {
      return; // Skip duplicate
    }
    seenCharts.add(chartKey);
    
    const colors = data.suggestedColors || data.colors_used || COLORS;
    
    // Transform data to match expected format (label, value, percentage)
    const chartData = pieDataArray.map((item: any) => ({
      label: item.label || item.player || item.name || 'Unknown',
      value: item.value || item.kills || 0,
      percentage: item.percentage || ''
    }));
    
    // Calculate total once for percentage calculations
    const total = chartData.reduce((sum: number, item: any) => sum + (item.value || 0), 0);
    
    chartComponents.push(
      <div key={`${keyPrefix}-pie-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
        <h3 className="text-lg font-semibold mb-3">
          {data.team || data.title || keyPrefix || 'Pie Chart'}
          {data.totalActions && ` (${data.totalActions} total)`}
          {data.total_kills && ` (${data.total_kills} total kills)`}
        </h3>
        <div style={{ width: '100%', height: '400px', minWidth: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
                label={(entry: any) => {
                  const label = entry.label || entry.name || '';
                  const value = entry.value || 0;
                  // Calculate percentage
                  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                  return `${label}: ${pct}%`;
              }}
              outerRadius={120}
              fill="#8884d8"
              dataKey="value"
            >
              {pieDataArray.map((item: any, index: number) => {
                // Use color from item if available, otherwise use colors array
                const color = item.color || colors[index % colors.length];
                return <Cell key={`cell-${index}`} fill={color} />;
              })}
            </Pie>
              <Tooltip formatter={(value: number, name: string, props: any) => {
                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                return [`${value} (${pct}%)`, props.payload?.label || name];
              }} />
              <Legend formatter={(value, entry: any) => entry?.payload?.label || value} />
          </PieChart>
        </ResponsiveContainer>
        </div>
      </div>
    );
    return;
  }
  
  // Check if it's bar chart or histogram data
  const barDataArray = data.barData || data.bar_chart_data || data.barChartData || data.histogramData;
  if (barDataArray && Array.isArray(barDataArray) && barDataArray.length > 0) {
    // Check for duplicates
    const chartKey = getChartDataKey(data, 'bar');
    if (seenCharts.has(chartKey)) {
      return; // Skip duplicate
    }
    seenCharts.add(chartKey);
    
    const isHistogram = data.histogramData || data.type === 'histogram';
    chartComponents.push(
      <div key={`${keyPrefix}-bar-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
        <h3 className="text-lg font-semibold mb-3">
          {data.team || data.title || keyPrefix || (isHistogram ? 'Histogram' : 'Bar Chart')}
        </h3>
        <div style={{ width: '100%', height: '400px', minWidth: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barDataArray}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="value" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
        </div>
      </div>
    );
    return;
  }
  
  // Check if it's plot_data (line chart data with point_number/efficiency structure)
  const plotDataArray = data.plot_data || data.plotData;
  if (plotDataArray && Array.isArray(plotDataArray) && plotDataArray.length > 0) {
    const firstItem = plotDataArray[0];
    if (firstItem && typeof firstItem === 'object') {
      // Check if it has chart-like structure (point_number, point_id, x, etc.)
      const hasXAxis = firstItem.point_number !== undefined || firstItem.pointNumber !== undefined ||
                       firstItem.point_id !== undefined || firstItem.pointId !== undefined ||
                       firstItem.x !== undefined;
      const hasYAxis = firstItem.point_efficiency !== undefined || firstItem.pointEfficiency !== undefined ||
                       firstItem.cumulative_efficiency !== undefined || firstItem.cumulativeEfficiency !== undefined ||
                       firstItem.efficiency !== undefined || firstItem.y !== undefined;
      
      if (hasXAxis && hasYAxis) {
        // Check for duplicates
        const chartKey = getChartDataKey(data, 'line');
        if (seenCharts.has(chartKey)) {
          return; // Skip duplicate
        }
        seenCharts.add(chartKey);
        
        // Determine X and Y axis fields
        const xField = firstItem.point_number !== undefined ? 'point_number' :
                      firstItem.pointNumber !== undefined ? 'pointNumber' :
                      firstItem.point_id !== undefined ? 'point_id' :
                      firstItem.pointId !== undefined ? 'pointId' :
                      firstItem.x !== undefined ? 'x' : 'label';
        
        // Transform data for Recharts (ensure numeric values)
        const chartData = plotDataArray.map((item: any) => {
          const transformed: any = {
            [xField]: item[xField] || item.point_number || item.point_id || item.x || 0
          };
          
          // Add all efficiency/value fields as separate lines
          if (item.point_efficiency !== undefined || item.pointEfficiency !== undefined) {
            transformed.point_efficiency = parseFloat(item.point_efficiency || item.pointEfficiency || 0);
          }
          if (item.cumulative_efficiency !== undefined || item.cumulativeEfficiency !== undefined) {
            transformed.cumulative_efficiency = parseFloat(item.cumulative_efficiency || item.cumulativeEfficiency || 0);
          }
          if (item.efficiency !== undefined) {
            transformed.efficiency = parseFloat(item.efficiency || 0);
          }
          if (item.y !== undefined) {
            transformed.y = parseFloat(item.y || 0);
          }
          
          return transformed;
        });
        
        // Determine which Y fields to plot
        const yFields: string[] = [];
        if (firstItem.point_efficiency !== undefined || firstItem.pointEfficiency !== undefined) {
          yFields.push('point_efficiency');
        }
        if (firstItem.cumulative_efficiency !== undefined || firstItem.cumulativeEfficiency !== undefined) {
          yFields.push('cumulative_efficiency');
        }
        if (firstItem.efficiency !== undefined && !yFields.includes('efficiency')) {
          yFields.push('efficiency');
        }
        if (firstItem.y !== undefined && yFields.length === 0) {
          yFields.push('y');
        }
        
        const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00'];
        
        chartComponents.push(
          <div key={`${keyPrefix}-line-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
            <h3 className="text-lg font-semibold mb-3">
              {data.title || data.team || keyPrefix || 'Line Chart'}
            </h3>
            <div style={{ width: '100%', height: '400px', minWidth: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={xField} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {yFields.map((field, idx) => (
                    <Line 
                      key={field}
                      type="monotone" 
                      dataKey={field} 
                      stroke={colors[idx % colors.length]}
                      name={field.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
        return;
      }
    }
  }
  
  // Check if it's line chart data
  const lineDataArray = data.lineData || data.line_chart_data || data.lineChartData;
  if (lineDataArray && Array.isArray(lineDataArray) && lineDataArray.length > 0) {
    // Check for duplicates
    const chartKey = getChartDataKey(data, 'line');
    if (seenCharts.has(chartKey)) {
      return; // Skip duplicate
    }
    seenCharts.add(chartKey);
    
    chartComponents.push(
      <div key={`${keyPrefix}-line-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
        <h3 className="text-lg font-semibold mb-3">
          {data.team || data.title || keyPrefix || 'Line Chart'}
        </h3>
        <div style={{ width: '100%', height: '400px', minWidth: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
          <LineChart data={lineDataArray}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="value" stroke="#8884d8" />
          </LineChart>
        </ResponsiveContainer>
        </div>
      </div>
    );
    return;
  }
  
  // Check if it's area chart data
  const areaDataArray = data.areaData || data.area_chart_data || data.areaChartData;
  if (areaDataArray && Array.isArray(areaDataArray) && areaDataArray.length > 0) {
    // Check for duplicates
    const chartKey = getChartDataKey(data, 'area');
    if (seenCharts.has(chartKey)) {
      return; // Skip duplicate
    }
    seenCharts.add(chartKey);
    
    chartComponents.push(
      <div key={`${keyPrefix}-area-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
        <h3 className="text-lg font-semibold mb-3">
          {data.team || data.title || keyPrefix || 'Area Chart'}
        </h3>
        <div style={{ width: '100%', height: '400px', minWidth: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={areaDataArray}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Area type="monotone" dataKey="value" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
          </AreaChart>
        </ResponsiveContainer>
        </div>
      </div>
    );
    return;
  }
  
  // Check for Plotly config (plotlyConfig) - check at root level first
  const plotlyConfig = data.plotlyConfig;
  if (plotlyConfig && plotlyConfig.data && Array.isArray(plotlyConfig.data) && plotlyConfig.data.length > 0) {
    const plotlyData = plotlyConfig.data[0];
    
    // Check for scatter plot
    if (plotlyData.type === 'scatter' && plotlyData.mode === 'markers' && 
        Array.isArray(plotlyData.x) && Array.isArray(plotlyData.y) && 
        plotlyData.x.length === plotlyData.y.length) {
      
      // Create unique key for deduplication
      const plotlyKey = `plotly-scatter-${JSON.stringify(plotlyData.x.slice(0, 10))}-${JSON.stringify(plotlyData.y.slice(0, 10))}`;
      if (seenCharts.has(plotlyKey)) {
        return; // Skip duplicate
      }
      seenCharts.add(plotlyKey);
      
      // Convert Plotly format to Recharts format
      const scatterData = plotlyData.x.map((x: number, index: number) => {
        const point: any = {
          x: x,
          y: plotlyData.y[index],
          z: plotlyData.marker?.size?.[index] || 8
        };
        
        // Add color if available
        if (plotlyData.marker?.color && Array.isArray(plotlyData.marker.color)) {
          point.color = plotlyData.marker.color[index];
        }
        
        // Add text for tooltip if available
        if (plotlyData.text && Array.isArray(plotlyData.text)) {
          point.text = plotlyData.text[index];
        }
        
        return point;
      });
      
      // Get title from layout
      const title = plotlyConfig.layout?.title?.text || data.title || keyPrefix || 'Scatter Plot';
      const xAxisTitle = plotlyConfig.layout?.xaxis?.title?.text || 'X';
      const yAxisTitle = plotlyConfig.layout?.yaxis?.title?.text || 'Y';
      
      // Get color groups for legend
      const colorGroups = new Set(plotlyData.marker?.color || []);
      
      chartComponents.push(
        <div key={`${keyPrefix}-plotly-scatter-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
          <h3 className="text-lg font-semibold mb-3">{title}</h3>
          <div style={{ width: '100%', height: '600px', minWidth: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  type="number" 
                  dataKey="x" 
                  name={xAxisTitle}
                  domain={plotlyConfig.layout?.xaxis?.range ? ['dataMin', 'dataMax'] : undefined}
                />
                <YAxis 
                  type="number" 
                  dataKey="y" 
                  name={yAxisTitle}
                  domain={plotlyConfig.layout?.yaxis?.range ? ['dataMin', 'dataMax'] : undefined}
                />
                <ZAxis type="number" dataKey="z" range={[20, 200]} name="Size" />
                <Tooltip 
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload[0]) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-black/90 p-3 rounded border border-white/20">
                          <p className="text-white">{data.text || `X: ${data.x}, Y: ${data.y}`}</p>
                          {data.color && <p className="text-sm text-gray-300">Color: {data.color}</p>}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
                {/* Render scatter points grouped by color */}
                {Array.from(colorGroups).map((color, colorIndex) => {
                  const colorData = scatterData.filter((d: any) => d.color === color);
                  const colorStr = typeof color === 'string' ? color : '#8884d8';
                  return (
                    <Scatter 
                      key={`scatter-${colorStr}-${colorIndex}`}
                      name={colorStr || 'Data'} 
                      data={colorData} 
                      fill={colorStr}
                    />
                  );
                })}
                {colorGroups.size === 0 && (
                  <Scatter name="Data" data={scatterData} fill="#8884d8" />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
      return;
    }
  }
  
  // Check if it's scatter plot data
  const scatterDataArray = data.scatterData || data.scatter_chart_data || data.scatterChartData;
  if (scatterDataArray && Array.isArray(scatterDataArray) && scatterDataArray.length > 0) {
    // Check for duplicates
    const chartKey = getChartDataKey(data, 'scatter');
    if (seenCharts.has(chartKey)) {
      return; // Skip duplicate
    }
    seenCharts.add(chartKey);
    
    chartComponents.push(
      <div key={`${keyPrefix}-scatter-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
        <h3 className="text-lg font-semibold mb-3">
          {data.team || data.title || keyPrefix || 'Scatter Plot'}
        </h3>
        <div style={{ width: '100%', height: '400px', minWidth: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" name="X" />
            <YAxis type="number" dataKey="y" name="Y" />
            <ZAxis type="number" dataKey="z" range={[60, 400]} name="Size" />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Legend />
            <Scatter name="Data" data={scatterDataArray} fill="#8884d8" />
          </ScatterChart>
        </ResponsiveContainer>
        </div>
      </div>
    );
    return;
  }
  
  // Check for nested chart data (like the user's example with ucsd/nau)
  // Also check if data is an object with an array property (like { players: [...], total_kills: 37 })
  if (!Array.isArray(data)) {
    // Check if it's an object with an array property that looks like player stats
    for (const key in data) {
      const nestedData = data[key];
      if (nestedData && typeof nestedData === 'object') {
        // If nestedData is an array, check if it's player stats
        if (Array.isArray(nestedData) && nestedData.length > 0 && nestedData[0] && typeof nestedData[0] === 'object') {
          const firstItem = nestedData[0];
          if (firstItem.player || firstItem.name || (firstItem.kills !== undefined && firstItem.percentage !== undefined)) {
            // It's an array of player stats - process it
            processChartData(nestedData, chartComponents, key, seenCharts);
            continue;
          }
        }
        // Check if nestedData has any chart data structure
        if (nestedData && typeof nestedData === 'object') {
          // Check for explicit chart data properties
          const hasChartData = nestedData.pie_chart_data || nestedData.pieData || nestedData.pie_data || nestedData.pieChartData ||
              nestedData.bar_chart_data || nestedData.barData || nestedData.barChartData || nestedData.histogramData ||
              nestedData.line_chart_data || nestedData.lineData || nestedData.lineChartData ||
              nestedData.area_chart_data || nestedData.areaData || nestedData.areaChartData ||
              nestedData.scatter_chart_data || nestedData.scatterData || nestedData.scatterChartData ||
              nestedData.plot_data || nestedData.plotData ||
              nestedData.x_series || nestedData.xSeries ||
              nestedData.y_series || nestedData.ySeries ||
              nestedData.plotlyConfig;
          
          if (hasChartData) {
            // Process with the key as prefix to ensure uniqueness
            processChartData(nestedData, chartComponents, key, seenCharts);
            continue;
          }
          // Don't recursively process arrays or nested objects if they don't have explicit chart data
          // This prevents processing the same data multiple times
        }
      }
    }
  }
  
  // DISABLED: Generic chart detection fallback
  // This was too aggressive and converted informational statistics into charts
  // Charts should only be created when explicit chart data properties are present
  // (pie_data, plot_data, x_series/y_series, barData, etc.)
  // 
  // If you want to enable generic chart detection, it should be much more strict:
  // - Only trigger if data has explicit chart indicators (e.g., "chart_type", "visualization", etc.)
  // - Or require specific field patterns that are clearly meant for charts
  /*
  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === 'object') {
    const firstItem = data[0];
    const keys = Object.keys(firstItem);
    
    // Find numeric fields (potential Y-axis values) - exclude common non-chart fields
    const excludeFields = ['id', 'timestamp', 'created_at', 'updated_at', 'uuid', 'key'];
    const numericFields = keys.filter(key => {
      if (excludeFields.includes(key.toLowerCase())) return false;
      const value = firstItem[key];
      return typeof value === 'number' || 
             (typeof value === 'string' && !isNaN(parseFloat(value)) && isFinite(parseFloat(value)) && value.trim() !== '');
    });
    
    // Find potential X-axis field (string, number, or date-like)
    const xField = keys.find(key => {
      if (excludeFields.includes(key.toLowerCase())) return false;
      const value = firstItem[key];
      const keyLower = key.toLowerCase();
      return keyLower.includes('x') || 
             keyLower.includes('point') ||
             keyLower.includes('time') ||
             keyLower.includes('date') ||
             keyLower.includes('label') ||
             keyLower.includes('name') ||
             keyLower.includes('category') ||
             keyLower.includes('index') ||
             (typeof value === 'string' && value.length < 50) ||
             typeof value === 'number';
    });
    
    // If we have numeric fields and an X field, it's chartable
    if (numericFields.length > 0 && xField && numericFields.length <= 10 && data.length >= 2) {
      const chartKey = `generic-${xField}-${numericFields.join(',')}`;
      if (seenCharts.has(chartKey)) {
        return; // Skip duplicate
      }
      seenCharts.add(chartKey);
      
      // Transform data for Recharts
      const chartData = data.map((item: any) => {
        const transformed: any = {
          [xField]: item[xField]
        };
        numericFields.forEach(field => {
          const value = item[field];
          transformed[field] = typeof value === 'number' ? value : parseFloat(value) || 0;
        });
        return transformed;
      });
      
      const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00', '#0088fe', '#00c49f', '#ffbb28', '#ff8042', '#8884d8'];
      
      chartComponents.push(
        <div key={`${keyPrefix}-generic-line-${chartComponents.length}`} className="my-4 p-4 bg-black/20 rounded-lg w-full">
          <h3 className="text-lg font-semibold mb-3">
            {keyPrefix || 'Chart'}
          </h3>
          <div style={{ width: '100%', height: '400px', minWidth: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={xField} />
                <YAxis />
                <Tooltip />
                <Legend />
                {numericFields.map((field, idx) => (
                  <Line 
                    key={field}
                    type="monotone" 
                    dataKey={field} 
                    stroke={colors[idx % colors.length]}
                    name={field.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }
  }
  */
}

export function ChartRenderer({ content, executionResults }: ChartRendererProps) {
  const charts = useMemo(() => {
    const chartComponents: JSX.Element[] = [];
    const seenCharts = new Set<string>(); // Track charts we've already rendered
    
    // First, check execution results directly (might already be an object)
    if (executionResults) {
      try {
        const data = typeof executionResults === 'string' ? JSON.parse(executionResults) : executionResults;
        // Check if it has chart data structure
        if (data && typeof data === 'object') {
          // Create a content-based hash to detect duplicates
          const contentHash = createContentHash(data);
          if (contentHash) {
            const duplicateKey = `execution-${contentHash}`;
            if (seenCharts.has(duplicateKey)) {
              // Already processed, skip
            } else {
              seenCharts.add(duplicateKey);
              processChartData(data, chartComponents, 'execution', seenCharts);
            }
          } else {
            // Fallback to old method for non-nested data
            const dataHash = JSON.stringify(data).substring(0, 200);
            const duplicateKey = `execution-${dataHash}`;
            if (!seenCharts.has(duplicateKey)) {
              seenCharts.add(duplicateKey);
              processChartData(data, chartComponents, 'execution', seenCharts);
            }
          }
        }
      } catch (e) {
        // Silently skip invalid execution results
      }
    }
    
    // Also check content for "Code Execution Result" format
    // Handle both plain text and markdown bold (**Code Execution Result**)
    // Find "Code Execution Result" then look for the next code block
    const codeExecutionResultPattern = /(?:\*\*)?Code Execution Result(?:\*\*)?/gi;
    let codeExecMatch;
    while ((codeExecMatch = codeExecutionResultPattern.exec(content)) !== null) {
      try {
        // Find the next ``` after "Code Execution Result"
        const afterMatch = content.substring(codeExecMatch.index + codeExecMatch[0].length);
        const codeBlockMatch = afterMatch.match(/```(?:json)?\s*\n?/);
        if (!codeBlockMatch || codeBlockMatch.index === undefined) continue;
        
        const jsonStart = codeExecMatch.index + codeExecMatch[0].length + codeBlockMatch.index + codeBlockMatch[0].length;
        const afterJsonStart = content.substring(jsonStart);
        
        // Find the matching closing ```
        let braceCount = 0;
        let bracketCount = 0;
        let inString = false;
        let escapeNext = false;
        let jsonEnd = -1;
        
        for (let i = 0; i < afterJsonStart.length; i++) {
          const char = afterJsonStart[i];
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
            if (char === '[') bracketCount++;
            if (char === ']') bracketCount--;
            
            // Check for closing ``` when braces are balanced
            if (braceCount === 0 && bracketCount === 0) {
              const remaining = afterJsonStart.substring(i);
              if (remaining.trim().startsWith('```')) {
                jsonEnd = i;
                break;
              }
            }
          }
        }
        
        if (jsonEnd > 0) {
          const jsonStr = afterJsonStart.substring(0, jsonEnd).trim();
          
          // Check if it looks like JSON (starts with {)
          if (jsonStr.startsWith('{') || jsonStr.startsWith('[')) {
            try {
            const data = JSON.parse(jsonStr);
              // Check if this was already processed from executionResults using content-based hash
              const contentHash = createContentHash(data);
              if (contentHash) {
                const duplicateKey = `execution-${contentHash}`;
                if (seenCharts.has(duplicateKey)) {
                  continue; // Skip if already processed from executionResults
                }
                const execContentKey = `execution-content-${contentHash}`;
                if (seenCharts.has(execContentKey)) {
                  continue; // Skip if already processed from this pattern
                }
                seenCharts.add(execContentKey);
                processChartData(data, chartComponents, 'execution-content', seenCharts);
              } else {
                // Fallback to old method
                const dataHash = JSON.stringify(data).substring(0, 200);
                const duplicateKey = `execution-${dataHash}`;
                if (seenCharts.has(duplicateKey)) {
                  continue;
                }
                const execContentKey = `execution-content-${dataHash}`;
                if (seenCharts.has(execContentKey)) {
                  continue;
                }
                seenCharts.add(execContentKey);
                processChartData(data, chartComponents, 'execution-content', seenCharts);
              }
            } catch (parseError) {
              // Skip invalid JSON
        }
          }
        }
      } catch (e) {
        // Skip invalid execution results
      }
    }
    
    // Try to find JSON objects in content
    // Look for JSON code blocks (with or without json language identifier)
    // Pattern 1: ```json ... ```
    const jsonBlockPattern = /```json\s*([\s\S]*?)\s*```/g;
    let match;
    while ((match = jsonBlockPattern.exec(content)) !== null) {
      try {
        const jsonStr = match[1].trim();
        // Skip if this is already in a Code Execution Result (avoid double processing)
        const beforeMatch = content.substring(0, match.index);
        if (beforeMatch.includes('Code Execution Result')) {
          continue;
        }
        const data = JSON.parse(jsonStr);
        // Check for duplicates
        const dataHash = JSON.stringify(data).substring(0, 200);
        const duplicateKey = `content-json-${dataHash}`;
        if (seenCharts.has(duplicateKey)) {
          continue;
        }
        seenCharts.add(duplicateKey);
        // Process chart data from JSON block
        processChartData(data, chartComponents, 'content', seenCharts);
      } catch (e) {
        // Not valid JSON, skip
        // Skip invalid JSON
      }
    }
    
    // Pattern 2: Any code block that starts with { and contains chart-related keys
    const anyCodeBlockPattern = /```[a-z]*\s*(\{[\s\S]*?"(?:pieData|pie_data|pie_chart_data|pieChartData|barData|bar_chart_data|barChartData|histogramData|lineData|line_chart_data|lineChartData|areaData|area_chart_data|areaChartData|scatterData|scatter_chart_data|scatterChartData|plotlyConfig|totalActions|suggestedColors|colors_used|total_kills)"[\s\S]*?\})\s*```/g;
    while ((match = anyCodeBlockPattern.exec(content)) !== null) {
      try {
        const jsonStr = match[1].trim();
        // Skip if this is already in a Code Execution Result (avoid double processing)
        const beforeMatch = content.substring(0, match.index);
        if (beforeMatch.includes('Code Execution Result')) {
          continue;
        }
        const data = JSON.parse(jsonStr);
        // Check for duplicates
        const dataHash = JSON.stringify(data).substring(0, 200);
        const duplicateKey = `content-pattern2-${dataHash}`;
        if (seenCharts.has(duplicateKey)) {
          continue;
        }
        seenCharts.add(duplicateKey);
        processChartData(data, chartComponents, 'content', seenCharts);
      } catch (e) {
        // Not valid JSON, skip
      }
    }
    
    // Pattern 3: Code block that might span multiple lines - more lenient
    // Look for code blocks and check if content is JSON
    // This pattern handles code blocks with or without language identifier
    const genericCodeBlockPattern = /```[^\n]*\n?([\s\S]*?)```/g;
    while ((match = genericCodeBlockPattern.exec(content)) !== null) {
      const codeContent = match[1].trim();
      // Check if it looks like JSON (starts with { or [ and contains EXPLICIT chart-related keys)
      // REMOVED generic keywords like "player", "kills", "percentage" - these are too broad and catch statistics data
      const isJsonLike = (codeContent.startsWith('{') || codeContent.startsWith('[')) && 
        (codeContent.includes('pieData') || codeContent.includes('pie_data') || codeContent.includes('pie_chart_data') || codeContent.includes('pieChartData') ||
         codeContent.includes('barData') || codeContent.includes('bar_chart_data') || codeContent.includes('barChartData') ||
         codeContent.includes('histogramData') ||
         codeContent.includes('lineData') || codeContent.includes('line_chart_data') || codeContent.includes('lineChartData') ||
         codeContent.includes('areaData') || codeContent.includes('area_chart_data') || codeContent.includes('areaChartData') ||
         codeContent.includes('scatterData') || codeContent.includes('scatter_chart_data') || codeContent.includes('scatterChartData') ||
         codeContent.includes('plot_data') || codeContent.includes('plotData') ||
         codeContent.includes('x_series') || codeContent.includes('xSeries') ||
         codeContent.includes('y_series') || codeContent.includes('ySeries') ||
         codeContent.includes('plotlyConfig') ||
         codeContent.includes('totalActions') || codeContent.includes('suggestedColors') ||
         codeContent.includes('colors_used'));
      
      if (isJsonLike) {
        try {
          // Skip if this is already in a Code Execution Result (avoid double processing)
          const beforeMatch = content.substring(0, match.index);
          if (beforeMatch.includes('Code Execution Result')) {
            continue;
          }
          const data = JSON.parse(codeContent);
          // Check for duplicates
          const dataHash = JSON.stringify(data).substring(0, 200);
          const duplicateKey = `content-pattern3-${dataHash}`;
          if (seenCharts.has(duplicateKey)) {
            continue;
          }
          seenCharts.add(duplicateKey);
          // Process chart data from code block
          processChartData(data, chartComponents, 'content', seenCharts);
        } catch (e) {
          // Not valid JSON, skip - might be incomplete or malformed
          // Skip invalid JSON
        }
      }
    }
    
    // Also try to find inline JSON objects (for pieData, barData, etc.)
    // This pattern looks for objects that contain EXPLICIT chart-related keys only
    // REMOVED generic keywords like "total_kills" - too broad and catches statistics data
    const inlineJsonPattern = /\{[\s\S]*?"(?:pieData|pie_data|pie_chart_data|pieChartData|barData|bar_chart_data|barChartData|histogramData|lineData|line_chart_data|lineChartData|areaData|area_chart_data|areaChartData|scatterData|scatter_chart_data|scatterChartData|plot_data|plotData|x_series|xSeries|y_series|ySeries|plotlyConfig|totalActions|suggestedColors|colors_used)"[\s\S]*?\}/g;
    let inlineMatch;
    while ((inlineMatch = inlineJsonPattern.exec(content)) !== null) {
      try {
        // Try to extract a complete JSON object
        let jsonStr = inlineMatch[0];
        // If it looks incomplete, try to find the matching closing brace
        let openBraces = (jsonStr.match(/\{/g) || []).length;
        let closeBraces = (jsonStr.match(/\}/g) || []).length;
        if (openBraces > closeBraces) {
          // Try to find the rest of the JSON
          const remainingContent = content.substring(inlineMatch.index + inlineMatch[0].length);
          let remainingStr = '';
          let remainingBraces = openBraces - closeBraces;
          for (let i = 0; i < remainingContent.length && remainingBraces > 0; i++) {
            remainingStr += remainingContent[i];
            if (remainingContent[i] === '{') remainingBraces++;
            if (remainingContent[i] === '}') remainingBraces--;
          }
          jsonStr += remainingStr;
        }
        const data = JSON.parse(jsonStr);
        // Check for duplicates
        const dataHash = JSON.stringify(data).substring(0, 200);
        const duplicateKey = `inline-${dataHash}`;
        if (seenCharts.has(duplicateKey)) {
          continue;
        }
        seenCharts.add(duplicateKey);
        processChartData(data, chartComponents, 'inline', seenCharts);
      } catch (e) {
        // Not valid JSON, skip
      }
    }
    
    return chartComponents;
  }, [content, executionResults]);
  
  if (charts.length === 0) {
    return null;
  }
  return <div className="my-4">{charts}</div>;
}
