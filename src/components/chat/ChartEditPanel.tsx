import { useState, useEffect } from "react";
import { X, Save, RotateCcw, Trash2 } from "lucide-react";

interface ChartEditPanelProps {
  chart: any;
  onSave: (updatedData: any) => void;
  onClose: () => void;
}

export function ChartEditPanel({ chart, onSave, onClose }: ChartEditPanelProps) {
  // Extract chart option
  const chartOption = chart.data?.option || chart.data || {};
  
  // State for editable properties
  const [title, setTitle] = useState(chartOption.title?.text || '');
  const [backgroundColor, setBackgroundColor] = useState(() => {
    // Get background color from option, default to white
    return chartOption.backgroundColor || '#ffffff';
  });
  const [seriesColors, setSeriesColors] = useState<string[]>(() => {
    // Extract colors from series or use default color array
    if (chartOption.color && Array.isArray(chartOption.color)) {
      return chartOption.color;
    }
    // Try to get colors from series
    if (chartOption.series && Array.isArray(chartOption.series)) {
      const colors = chartOption.series
        .map((s: any) => s.itemStyle?.color || s.lineStyle?.color || s.areaStyle?.color)
        .filter((c: any) => c);
      if (colors.length > 0) return colors;
    }
    // Default ECharts colors
    return ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'];
  });
  
  const [seriesNames, setSeriesNames] = useState<string[]>(() => {
    if (chartOption.series && Array.isArray(chartOption.series)) {
      return chartOption.series.map((s: any) => s.name || 'Series');
    }
    return [];
  });

  // Axis names
  const [xAxisName, setXAxisName] = useState(() => {
    const xAxis = Array.isArray(chartOption.xAxis) ? chartOption.xAxis[0] : chartOption.xAxis;
    return xAxis?.name || '';
  });
  
  const [yAxisName, setYAxisName] = useState(() => {
    const yAxis = Array.isArray(chartOption.yAxis) ? chartOption.yAxis[0] : chartOption.yAxis;
    return yAxis?.name || '';
  });

  // Data values for removal
  const [xAxisData, setXAxisData] = useState<any[]>(() => {
    const xAxis = Array.isArray(chartOption.xAxis) ? chartOption.xAxis[0] : chartOption.xAxis;
    return xAxis?.data ? [...xAxis.data] : [];
  });

  const [seriesData, setSeriesData] = useState<any[][]>(() => {
    if (chartOption.series && Array.isArray(chartOption.series)) {
      return chartOption.series.map((s: any) => s.data ? [...s.data] : []);
    }
    return [];
  });

  // Update colors when chart changes
  useEffect(() => {
    const option = chart.data?.option || chart.data || {};
    if (option.color && Array.isArray(option.color)) {
      setSeriesColors(option.color);
    }
    if (option.title?.text) {
      setTitle(option.title.text);
    }
    if (option.backgroundColor) {
      setBackgroundColor(option.backgroundColor);
    }
    if (option.series && Array.isArray(option.series)) {
      setSeriesNames(option.series.map((s: any) => s.name || 'Series'));
      setSeriesData(option.series.map((s: any) => s.data ? [...s.data] : []));
    }
    const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
    const yAxis = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis;
    if (xAxis?.name) setXAxisName(xAxis.name);
    if (yAxis?.name) setYAxisName(yAxis.name);
    if (xAxis?.data) setXAxisData([...xAxis.data]);
  }, [chart]);

  const handleColorChange = (index: number, color: string) => {
    const newColors = [...seriesColors];
    newColors[index] = color;
    setSeriesColors(newColors);
  };

  const handleRemoveValue = (index: number) => {
    if (xAxisData.length <= 1) return; // Don't remove if only one value left
    
    const newXAxisData = xAxisData.filter((_, i) => i !== index);
    setXAxisData(newXAxisData);
    
    // Remove corresponding values from all series
    const newSeriesData = seriesData.map(series => 
      series.filter((_, i) => i !== index)
    );
    setSeriesData(newSeriesData);
  };

  const handleSeriesNameChange = (index: number, name: string) => {
    const newNames = [...seriesNames];
    newNames[index] = name;
    setSeriesNames(newNames);
  };

  const handleSave = () => {
    const option = chart.data?.option || chart.data || {};
    const updatedOption = { ...option };
    
    // Update title
    if (title) {
      updatedOption.title = {
        ...updatedOption.title,
        text: title
      };
    }
    
    // Update background color
    updatedOption.backgroundColor = backgroundColor;
    
    // Update colors
    updatedOption.color = seriesColors;
    
    // Update series colors
    if (updatedOption.series && Array.isArray(updatedOption.series)) {
      updatedOption.series = updatedOption.series.map((series: any, index: number) => {
        const color = seriesColors[index % seriesColors.length];
        return {
          ...series,
          itemStyle: { ...series.itemStyle, color },
          lineStyle: series.lineStyle ? { ...series.lineStyle, color } : undefined,
          areaStyle: series.areaStyle ? { ...series.areaStyle, color } : undefined,
        };
      });
    }
    
    // Update series names and data
    if (updatedOption.series && Array.isArray(updatedOption.series)) {
      updatedOption.series = updatedOption.series.map((series: any, index: number) => {
        const updatedSeries: any = { ...series };
        if (seriesNames[index]) {
          updatedSeries.name = seriesNames[index];
        }
        if (seriesData[index] && seriesData[index].length > 0) {
          updatedSeries.data = seriesData[index];
        }
        return updatedSeries;
      });
    }
    
    // Update x-axis name and data
    const xAxis = Array.isArray(updatedOption.xAxis) ? updatedOption.xAxis[0] : updatedOption.xAxis;
    if (xAxis) {
      const updatedXAxis = { ...xAxis };
      if (xAxisName) {
        updatedXAxis.name = xAxisName;
      }
      if (xAxisData.length > 0) {
        updatedXAxis.data = xAxisData;
      }
      if (Array.isArray(updatedOption.xAxis)) {
        updatedOption.xAxis[0] = updatedXAxis;
      } else {
        updatedOption.xAxis = updatedXAxis;
      }
    }
    
    // Update y-axis name
    const yAxis = Array.isArray(updatedOption.yAxis) ? updatedOption.yAxis[0] : updatedOption.yAxis;
    if (yAxis) {
      const updatedYAxis = { ...yAxis };
      if (yAxisName) {
        updatedYAxis.name = yAxisName;
      }
      if (Array.isArray(updatedOption.yAxis)) {
        updatedOption.yAxis[0] = updatedYAxis;
      } else {
        updatedOption.yAxis = updatedYAxis;
      }
    }
    
    // Preserve the original structure
    const updatedData = chart.data?.option 
      ? { ...chart.data, option: updatedOption }
      : updatedOption;
    
    onSave(updatedData);
  };

  const handleReset = () => {
    const option = chart.data?.option || chart.data || {};
    setTitle(option.title?.text || '');
    setBackgroundColor(option.backgroundColor || '#ffffff');
    if (option.color && Array.isArray(option.color)) {
      setSeriesColors(option.color);
    }
    if (option.series && Array.isArray(option.series)) {
      setSeriesNames(option.series.map((s: any) => s.name || 'Series'));
      setSeriesData(option.series.map((s: any) => s.data ? [...s.data] : []));
    }
    const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
    const yAxis = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis;
    setXAxisName(xAxis?.name || '');
    setYAxisName(yAxis?.name || '');
    setXAxisData(xAxis?.data ? [...xAxis.data] : []);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div 
        className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-bold text-white">Edit Chart</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Title Editor */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Chart Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter chart title"
            />
          </div>

          {/* Background Color Editor */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Background Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                className="w-16 h-10 rounded border border-gray-600 cursor-pointer"
              />
              <input
                type="text"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="#ffffff"
              />
              <button
                onClick={() => setBackgroundColor('#ffffff')}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
                title="White"
              >
                White
              </button>
              <button
                onClick={() => setBackgroundColor('#1a1a1a')}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
                title="Dark"
              >
                Dark
              </button>
            </div>
          </div>

          {/* Axis Names Editor */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                X-Axis Name
              </label>
              <input
                type="text"
                value={xAxisName}
                onChange={(e) => setXAxisName(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="X-axis label"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Y-Axis Name
              </label>
              <input
                type="text"
                value={yAxisName}
                onChange={(e) => setYAxisName(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Y-axis label"
              />
            </div>
          </div>

          {/* Series Names Editor */}
          {seriesNames.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">
                Series Names
              </label>
              <div className="space-y-2">
                {seriesNames.map((name, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => handleSeriesNameChange(index, e.target.value)}
                      className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={`Series ${index + 1}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Values - Remove */}
          {xAxisData.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">
                Data Values (Click to Remove)
              </label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {xAxisData.map((label, index) => (
                  <div key={index} className="flex items-center gap-3 p-2 bg-gray-700/50 rounded hover:bg-gray-700">
                    <span className="text-sm text-gray-300 flex-1">
                      <span className="font-medium">{label}</span>
                      {seriesData.map((series, seriesIndex) => (
                        <span key={seriesIndex} className="ml-3 text-gray-400">
                          {seriesNames[seriesIndex] || `Series ${seriesIndex + 1}`}: {series[index] ?? 'N/A'}
                        </span>
                      ))}
                    </span>
                    <button
                      onClick={() => handleRemoveValue(index)}
                      disabled={xAxisData.length <= 1}
                      className="p-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded text-red-300 hover:text-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Remove this value"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {xAxisData.length} value{xAxisData.length !== 1 ? 's' : ''} remaining
              </p>
            </div>
          )}

          {/* Series Colors Editor */}
          {seriesNames.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">
                Series Colors
              </label>
              <div className="space-y-3">
                {seriesNames.map((name, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <span className="text-sm text-gray-400 w-32 truncate">{name}</span>
                    <input
                      type="color"
                      value={seriesColors[index] || '#5470c6'}
                      onChange={(e) => handleColorChange(index, e.target.value)}
                      className="w-16 h-10 rounded border border-gray-600 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={seriesColors[index] || '#5470c6'}
                      onChange={(e) => handleColorChange(index, e.target.value)}
                      className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="#5470c6"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Global Color Palette */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Color Palette
            </label>
            <div className="grid grid-cols-3 gap-3">
              {seriesColors.map((color, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => handleColorChange(index, e.target.value)}
                    className="w-12 h-12 rounded border border-gray-600 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={color}
                    onChange={(e) => handleColorChange(index, e.target.value)}
                    className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={() => setSeriesColors([...seriesColors, '#5470c6'])}
              className="mt-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              Add Color
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-700">
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

