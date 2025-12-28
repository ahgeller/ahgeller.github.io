import { useState, useRef, useEffect } from "react";
import { X, Download, Maximize2, Copy, Check, Minimize2, Trash2, Edit2 } from "lucide-react";
import * as echarts from 'echarts';
import { useAppStore } from '@/store/useAppStore';
import { formatChartTime, formatTimestamp } from '@/lib/dateFormatter';
import { ChartEditPanel } from './ChartEditPanel';

interface ChartGalleryProps {
  onClose: () => void;
  onSelectChart?: (chartId: string) => void;
}

// Mini chart component for gallery
function MiniChart({ chart }: { chart: any }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current || chart.type !== 'echarts') return;

    // Initialize chart with null theme for light background
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }

    // Set option
    try {
      // Ensure data is valid
      if (!chart.data) {
        console.error('Chart data is undefined');
        return;
      }

      // Extract the actual option from the data
      let chartOption = chart.data;
      
      // If data has an 'option' property, use that
      if (chart.data.option) {
        chartOption = chart.data.option;
      }

      // Ensure backgroundColor is set
      if (!chartOption.backgroundColor) {
        chartOption.backgroundColor = '#ffffff';
      }

      // Adjust grid to move chart a bit to the left
      if (!chartOption.grid) {
        chartOption.grid = {};
      }
      // Reduce left padding to move chart left
      if (typeof chartOption.grid.left === 'string') {
        // Convert percentage to number, reduce by ~3%, convert back
        const currentLeft = parseFloat(chartOption.grid.left);
        chartOption.grid.left = Math.max(3, currentLeft - 3) + '%';
      } else if (typeof chartOption.grid.left === 'number') {
        chartOption.grid.left = Math.max(30, chartOption.grid.left - 20);
      } else {
        chartOption.grid.left = '5%';
      }
      // Ensure containLabel is set
      if (chartOption.grid.containLabel === undefined) {
        chartOption.grid.containLabel = true;
      }

      chartInstanceRef.current.setOption(chartOption, true);
      chartInstanceRef.current.resize();
    } catch (error) {
      console.error('Error rendering chart:', error, chart.data);
    }

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      chartInstanceRef.current?.resize();
    });
    
    if (chartRef.current) {
      resizeObserver.observe(chartRef.current);
    }

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, [chart]);

  if (chart.type === 'echarts') {
    return <div ref={chartRef} className="w-full h-full min-h-[200px]" />;
  }

  return (
    <div className="text-gray-500 text-sm flex items-center justify-center h-full">
      {chart.type} Chart
    </div>
  );
}

export function ChartGallery({ onClose, onSelectChart }: ChartGalleryProps) {
  // Get charts and actions from store
  const { charts, updateChart, deleteChart, clearCharts } = useAppStore();
  
  const [selectedChart, setSelectedChart] = useState<string | null>(null);
  const [editingChart, setEditingChart] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fullscreenChartRef = useRef<HTMLDivElement>(null);
  const fullscreenInstanceRef = useRef<echarts.ECharts | null>(null);

  // Render fullscreen chart
  useEffect(() => {
    if (!selectedChart || !fullscreenChartRef.current) {
      // Clean up chart instance if no chart is selected
      if (fullscreenInstanceRef.current) {
        fullscreenInstanceRef.current.dispose();
        fullscreenInstanceRef.current = null;
      }
      return;
    }

    const chart = charts.find(c => c.id === selectedChart);
    if (!chart || chart.type !== 'echarts') return;

    // Always dispose old instance before creating new one
    if (fullscreenInstanceRef.current) {
      fullscreenInstanceRef.current.dispose();
      fullscreenInstanceRef.current = null;
    }

    // Initialize fresh chart instance
    fullscreenInstanceRef.current = echarts.init(fullscreenChartRef.current);

    try {
      if (!chart.data) {
        console.error('Chart data is undefined for fullscreen');
        return;
      }

      // Extract the actual option from the data
      let chartOption = chart.data;
      
      // If data has an 'option' property, use that
      if (chart.data.option) {
        chartOption = chart.data.option;
      }

      // Ensure backgroundColor is set
      if (!chartOption.backgroundColor) {
        chartOption.backgroundColor = '#ffffff';
      }

      // Adjust grid to move chart a bit to the left
      if (!chartOption.grid) {
        chartOption.grid = {};
      }
      // Reduce left padding to move chart left
      if (typeof chartOption.grid.left === 'string') {
        // Convert percentage to number, reduce by ~3%, convert back
        const currentLeft = parseFloat(chartOption.grid.left);
        chartOption.grid.left = Math.max(3, currentLeft - 3) + '%';
      } else if (typeof chartOption.grid.left === 'number') {
        chartOption.grid.left = Math.max(30, chartOption.grid.left - 20);
      } else {
        chartOption.grid.left = '5%';
      }
      // Ensure containLabel is set
      if (chartOption.grid.containLabel === undefined) {
        chartOption.grid.containLabel = true;
      }

      fullscreenInstanceRef.current.setOption(chartOption, true);
      fullscreenInstanceRef.current.resize();
    } catch (error) {
      console.error('Error rendering fullscreen chart:', error, chart.data);
    }

    // Handle resize
    const handleResize = () => {
      fullscreenInstanceRef.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    // Initial resize after a short delay
    setTimeout(() => {
      fullscreenInstanceRef.current?.resize();
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      // Dispose chart instance on cleanup
      if (fullscreenInstanceRef.current) {
        fullscreenInstanceRef.current.dispose();
        fullscreenInstanceRef.current = null;
      }
    };
  }, [selectedChart, charts]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (fullscreenInstanceRef.current) {
        fullscreenInstanceRef.current.dispose();
        fullscreenInstanceRef.current = null;
      }
    };
  }, []);

  const handleDownload = (chart: any) => {
    if (chart.type === 'echarts') {
      // Find the chart instance from the rendered mini charts
      const chartElement = document.getElementById(`gallery-chart-${chart.id}`);
      if (chartElement) {
        // Get the echarts instance
        const chartInstance = echarts.getInstanceByDom(chartElement.querySelector('div') as HTMLDivElement);
        if (chartInstance) {
          // Export as PNG
          const imageDataURL = chartInstance.getDataURL({
            type: 'png',
            pixelRatio: 2,
            backgroundColor: '#fff'
          });
          
          // Create download link
          const link = document.createElement('a');
          link.download = `chart-${chart.id}-${Date.now()}.png`;
          link.href = imageDataURL;
          link.click();
        }
      }
    }
  };

  const handleDelete = (chartId: string) => {
    if (confirm('Are you sure you want to delete this chart?')) {
      deleteChart(chartId);
      if (selectedChart === chartId) {
        setSelectedChart(null);
      }
    }
  };

  const handleCopyData = (chart: any) => {
    navigator.clipboard.writeText(JSON.stringify(chart.data, null, 2));
    setCopiedId(chart.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleChartClick = (chartId: string) => {
    if (selectedChart === chartId) {
      setSelectedChart(null);
    } else {
      setSelectedChart(chartId);
      onSelectChart?.(chartId);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50"
      style={{ 
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        backdropFilter: 'blur(4px)'
      }}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="w-full h-full flex flex-col"
        style={{ 
          backgroundColor: '#111827',
          position: 'relative',
          zIndex: 1
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between p-4 border-b"
          style={{ 
            backgroundColor: '#111827',
            borderColor: '#1f2937',
            position: 'relative',
            zIndex: 10
          }}
        >
          <div>
            <h2 className="text-xl font-bold text-white">Chart Gallery</h2>
            <p className="text-sm text-gray-400">{charts.length} visualizations</p>
          </div>
          <div className="flex items-center gap-2">
            {charts.length > 0 && (
              <button
                onClick={() => {
                  if (confirm(`Delete all ${charts.length} charts?`)) {
                    clearCharts();
                  }
                }}
                className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded text-sm text-red-300 hover:text-red-200 transition flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete All
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <X className="w-6 h-6 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Gallery Grid */}
        <div 
          className="flex-1 overflow-y-auto p-6"
          style={{ 
            backgroundColor: '#111827',
            position: 'relative',
            zIndex: 0
          }}
        >
          {charts.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-gray-400 text-lg mb-2">No charts yet</p>
                <p className="text-gray-500 text-sm">
                  Create visualizations by asking questions about your data
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {charts.map((chart) => (
                <div
                  key={chart.id}
                  className={`bg-gray-800 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                    selectedChart === chart.id
                      ? "border-blue-500 shadow-lg shadow-blue-500/20"
                      : "border-gray-700 hover:border-gray-600"
                  }`}
                  onClick={() => handleChartClick(chart.id)}
                >
                  {/* Chart Preview */}
                  <div
                    id={`gallery-chart-${chart.id}`}
                    className="aspect-video p-2 border border-border"
                    style={{
                      backgroundColor: (() => {
                        const option = chart.data?.option || chart.data || {};
                        return option.backgroundColor || '#ffffff';
                      })()
                    }}
                  >
                    <MiniChart chart={chart} />
                  </div>

                  {/* Chart Info */}
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-300 uppercase">
                        {chart.type}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatChartTime(chart.timestamp)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(chart);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 text-sm rounded transition-colors"
                        title="Download as PNG"
                      >
                        <Download className="w-4 h-4" />
                        PNG
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyData(chart);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
                        title="Copy chart data"
                      >
                        {copiedId === chart.id ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Data
                          </>
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingChart(chart.id);
                        }}
                        className="p-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded transition-colors"
                        title="Edit chart"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedChart(chart.id);
                        }}
                        className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                        title="View fullscreen"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(chart.id);
                        }}
                        className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded transition-colors"
                        title="Delete chart"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chart Edit Panel */}
        {editingChart && (() => {
          const chart = charts.find(c => c.id === editingChart);
          if (!chart) return null;
          return (
            <ChartEditPanel
              chart={chart}
              onSave={(updatedData) => {
                updateChart(editingChart, { data: updatedData });
                setEditingChart(null);
              }}
              onClose={() => setEditingChart(null)}
            />
          );
        })()}

        {/* Fullscreen Chart Modal */}
        {selectedChart && (
          <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md flex items-center justify-center p-8">
            <div className="w-full h-full max-w-7xl max-h-[90vh] bg-background rounded-lg overflow-hidden flex flex-col border border-border">
              {/* Fullscreen Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {charts.find(c => c.id === selectedChart)?.type} Chart
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {formatTimestamp(charts.find(c => c.id === selectedChart)?.timestamp || 0)}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedChart(null)}
                  className="p-2 hover:bg-accent rounded-lg transition-colors"
                >
                  <Minimize2 className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
              
              {/* Fullscreen Chart */}
              <div 
                className="flex-1 p-4"
                style={{
                  backgroundColor: (() => {
                    const chart = charts.find(c => c.id === selectedChart);
                    if (!chart) return '#ffffff';
                    const option = chart.data?.option || chart.data || {};
                    return option.backgroundColor || '#ffffff';
                  })()
                }}
              >
                <div ref={fullscreenChartRef} className="w-full h-full" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
