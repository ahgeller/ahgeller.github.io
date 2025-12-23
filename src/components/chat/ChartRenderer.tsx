import { useMemo, useRef, useEffect, useState } from 'react';
import { generatePrefixedId } from '@/lib/idGenerator';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts';
import { useAppStore } from '@/store/useAppStore';

interface ChartRendererProps {
  content: string;
  executionResults?: any;
}

// Direct ECharts component with full feature support
function DirectECharts({ 
  option, 
  style, 
  title 
}: { 
  option: EChartsOption; 
  style?: React.CSSProperties;
  title?: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const [chartType, setChartType] = useState<string>('');
  const [currentOption, setCurrentOption] = useState<EChartsOption>(option);
  const [addedToGallery, setAddedToGallery] = useState(false);
  const { addChart } = useAppStore();

  // Initialize chart once
  useEffect(() => {
    if (!chartRef.current || chartInstanceRef.current) return;
    
    chartInstanceRef.current = echarts.init(chartRef.current, 'dark', { renderer: 'canvas' });
    
    // Initial resize to ensure proper sizing
    requestAnimationFrame(() => {
      chartInstanceRef.current?.resize();
    });
    
    // Only handle window resize - no ResizeObserver to prevent scroll interference
    const handleResize = () => {
      chartInstanceRef.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  // Detect initial chart type
  useEffect(() => {
    if (option?.series && Array.isArray(option.series) && option.series.length > 0) {
      const firstSeries = option.series[0] as any;
      const detectedType = firstSeries.type || 'line';
      setChartType(detectedType);
    }
    setCurrentOption(option);
  }, [option]);

  // Update option when it changes
  useEffect(() => {
    if (!chartInstanceRef.current) return;
    
    try {
      // Enhanced option with animations and interactions
      const firstSeriesType = option.series && Array.isArray(option.series) 
        ? (option.series[0] as any)?.type 
        : null;
      const isPie = firstSeriesType === 'pie';
      const shouldHaveDataZoom = !isPie; // Enable zoom for scatter plots
      
      // Fix markLine.data format if present (must be array of arrays/pairs)
      const fixMarkLineInSeries = (series: any) => {
        if (!series || !Array.isArray(series)) return series;
        // Filter out null/undefined series items to prevent errors
        return series
          .filter((s: any) => s !== null && s !== undefined)
          .map((s: any) => {
          if (s.markLine && s.markLine.data && Array.isArray(s.markLine.data)) {
            // Fix markLine.data format - convert single objects to pairs
            const fixedData: any[] = [];
            for (const item of s.markLine.data) {
              if (item && typeof item === 'object' && !Array.isArray(item)) {
                // Single object - convert to pair format [point, point] for vertical line
                const point: any = {};
                if (item.xAxis !== undefined) {
                  point.xAxis = item.xAxis;
                }
                if (item.yAxis !== undefined) {
                  point.yAxis = item.yAxis;
                }
                if (item.name !== undefined) {
                  point.name = item.name;
                }
                if (item.lineStyle) {
                  point.lineStyle = item.lineStyle;
                }
                if (item.label) {
                  point.label = item.label;
                }
                // Create pair for vertical/horizontal line
                fixedData.push([point, { ...point }]);
              } else if (Array.isArray(item)) {
                // Already in pair format
                fixedData.push(item);
              }
            }
            return {
              ...s,
              markLine: {
                ...s.markLine,
                data: fixedData
              }
            };
          }
          return s;
        });
      };

      // Fix legend to match series names
      const fixLegend = (opt: any) => {
        if (!opt.series || !Array.isArray(opt.series)) return opt;
        // Filter out null/undefined series items before mapping to prevent errors
        const seriesNames = opt.series
          .filter((s: any) => s !== null && s !== undefined)
          .map((s: any) => s?.name)
          .filter((name: any) => name !== undefined && name !== null);
        
        if (seriesNames.length > 0) {
          return {
            ...opt,
            series: fixMarkLineInSeries(opt.series),
            legend: opt.legend ? {
              ...opt.legend,
              data: seriesNames
            } : {
              show: true,
              data: seriesNames,
              textStyle: { color: '#fff' }
            }
          };
        }
        return {
          ...opt,
          series: fixMarkLineInSeries(opt.series)
        };
      };

      const fixedOption = fixLegend(option);
      
      const enhancedOption: EChartsOption = {
        ...fixedOption,
        // Preserve the fixed series
        series: fixedOption.series,
        animation: true,
        animationDuration: 800,
        animationEasing: 'cubicOut' as const,
        // Add toolbox for built-in features
        toolbox: {
          show: true,
          right: '5%',
          top: '5%',
          feature: {
            dataZoom: {
              yAxisIndex: 'none' as const,
              title: { zoom: 'Area Zoom', back: 'Reset Zoom' }
            },
            restore: { title: 'Restore' },
            saveAsImage: { 
              title: 'Download',
              pixelRatio: 2,
              backgroundColor: '#1a1a1a'
            }
          },
          iconStyle: {
            borderColor: '#fff',
            borderWidth: 1.5
          },
          emphasis: {
            iconStyle: {
              borderColor: '#5470c6'
            }
          }
        },
        // Add data zoom for large datasets (but not for pie/scatter)
        dataZoom: shouldHaveDataZoom ? [
          {
            type: 'slider',
            start: 0,
            end: 100,
            textStyle: { color: '#fff' },
            bottom: 10,
            height: 20,
            borderColor: '#fff',
            fillerColor: 'rgba(84, 112, 198, 0.4)',
            handleStyle: { color: '#5470c6' }
          },
          {
            type: 'inside',
            start: 0,
            end: 100
          }
        ] : undefined,
        // Fix legend position to not overlap with title/subtitle
        legend: option.legend ? {
          ...option.legend,
          top: 50, // Push legend below title/subtitle
          textStyle: { color: '#fff', ...(option.legend as any)?.textStyle }
        } : undefined,
        // Grid settings with proper spacing
        grid: shouldHaveDataZoom ? {
          left: '5%',
          right: '8%',
          bottom: 80, // Space for zoom slider + x-axis labels
          top: 90, // Space for title + legend
          containLabel: true
        } : {
          left: '5%',
          right: '8%',
          bottom: 60, // Space for x-axis labels
          top: 90, // Space for title + legend
          containLabel: true
        },
        // Enhance axis labels to prevent cutoff
        xAxis: option.xAxis ? (Array.isArray(option.xAxis) ? option.xAxis.map((axis: any) => ({
          ...axis,
          axisLabel: {
            ...axis.axisLabel,
            rotate: axis.axisLabel?.rotate !== undefined ? axis.axisLabel.rotate : (axis.type === 'category' ? 30 : 0),
            interval: axis.axisLabel?.interval !== undefined ? axis.axisLabel.interval : 0,
            overflow: 'truncate',
            width: 70,
            color: '#fff',
            fontSize: 11
          }
        })) : {
          ...option.xAxis,
          axisLabel: {
            ...(option.xAxis as any).axisLabel,
            rotate: (option.xAxis as any).axisLabel?.rotate !== undefined ? (option.xAxis as any).axisLabel.rotate : ((option.xAxis as any).type === 'category' ? 30 : 0),
            interval: (option.xAxis as any).axisLabel?.interval !== undefined ? (option.xAxis as any).axisLabel.interval : 0,
            overflow: 'truncate',
            width: 70,
            color: '#fff',
            fontSize: 11
          }
        }) : undefined,
        yAxis: option.yAxis ? (Array.isArray(option.yAxis) ? option.yAxis.map((axis: any) => ({
          ...axis,
          axisLabel: {
            ...axis.axisLabel,
            overflow: axis.axisLabel?.overflow || 'break'
          }
        })) : {
          ...option.yAxis,
          axisLabel: {
            ...(option.yAxis as any).axisLabel,
            overflow: (option.yAxis as any).axisLabel?.overflow || 'break'
          }
        }) : undefined
      };
      
      // Validate option before setting
      try {
        chartInstanceRef.current.setOption(enhancedOption, true);
        setCurrentOption(enhancedOption);
        
        // Resize after setting option to fix proportions
        requestAnimationFrame(() => {
          setTimeout(() => {
            chartInstanceRef.current?.resize();
          }, 50);
        });
      } catch (setOptionError: any) {
        console.error('Error setting ECharts option:', setOptionError);
        // Try to set a minimal valid option to prevent crash
        try {
          const minimalOption: EChartsOption = {
            title: { text: 'Chart Error', left: 'center', textStyle: { color: '#fff' } },
            tooltip: { trigger: 'item' },
            series: [{
              type: 'scatter',
              data: [],
              name: 'Error'
            }]
          };
          chartInstanceRef.current.setOption(minimalOption, true);
        } catch (fallbackError) {
          console.error('Failed to set fallback option:', fallbackError);
        }
      }
    } catch (error) {
      console.error('Error processing ECharts option:', error);
    }
  }, [option]);

  // Download chart as image
  const downloadChart = () => {
    const chart = chartInstanceRef.current;
    if (!chart) return;
    
    const url = chart.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#1a1a1a'
    });
    
    const link = document.createElement('a');
    link.download = `${title || 'chart'}.png`;
    link.href = url;
    link.click();
  };

  // Change chart type dynamically
  const changeChartType = (newType: string) => {
    if (!currentOption?.series || !Array.isArray(currentOption.series)) return;
    
    const currentType = (currentOption.series[0] as any)?.type;
    
    if (currentType === 'pie' || newType === 'pie') {
      alert('Pie charts cannot be converted to other types');
      return;
    }
    
    const shouldHaveDataZoom = newType !== 'pie'; // Enable zoom for scatter plots
    
    const modifiedOption: EChartsOption = {
      ...currentOption,
      series: currentOption.series.map((s: any) => ({
        ...s,
        type: newType,
        smooth: newType === 'line' ? true : undefined
      })),
      // Preserve toolbox
      toolbox: currentOption.toolbox || {
        show: true,
        right: '5%',
        top: '5%',
        feature: {
          dataZoom: { yAxisIndex: 'none' as const, title: { zoom: 'Area Zoom', back: 'Reset Zoom' } },
          restore: { title: 'Restore' },
          saveAsImage: { title: 'Download', pixelRatio: 2, backgroundColor: '#1a1a1a' }
        },
        iconStyle: { borderColor: '#fff', borderWidth: 1.5 }
      },
      // Preserve or update dataZoom
      dataZoom: shouldHaveDataZoom ? (currentOption.dataZoom || [
        {
          type: 'slider',
          start: 0,
          end: 100,
          textStyle: { color: '#fff' },
          bottom: 30,
          height: 20,
          borderColor: '#fff',
          fillerColor: 'rgba(84, 112, 198, 0.4)',
          handleStyle: { color: '#5470c6' }
        },
        { type: 'inside', start: 0, end: 100 }
      ]) : undefined,
      // Preserve or update grid with equal spacing
      grid: shouldHaveDataZoom ? {
        left: '10%', // Equal spacing on both sides
        right: '10%', // Equal spacing on both sides
        bottom: '80px', // Extra space for zoom slider
        top: '12%',
        containLabel: true
      } : {
        left: '10%', // Equal spacing on both sides
        right: '10%', // Equal spacing on both sides
        bottom: '15%',
        top: '12%',
        containLabel: true
      }
    };
    
    chartInstanceRef.current?.setOption(modifiedOption, true);
    setCurrentOption(modifiedOption);
    setChartType(newType);
    
    setTimeout(() => {
      chartInstanceRef.current?.resize();
    }, 100);
  };

  // Only allow chart type switching for compatible types (bar, line, scatter, histogram)
  // Incompatible types: pie, heatmap, radar, graph, tree, sankey, funnel, gauge, etc.
  const compatibleChartTypes = ['bar', 'line', 'scatter', 'histogram'];
  const canSwitchChartType = compatibleChartTypes.includes(chartType);

  return (
    <div className="space-y-3">
      {/* Chart Controls */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          {canSwitchChartType && (
            <div className="flex gap-1 bg-white/5 rounded p-1">
              <button
                onClick={() => changeChartType('bar')}
                className={`px-3 py-1 rounded text-sm transition ${
                  chartType === 'bar' ? 'bg-blue-500 text-white' : 'text-white/70 hover:text-white'
                }`}
              >
                📊 Bar
              </button>
              <button
                onClick={() => changeChartType('line')}
                className={`px-3 py-1 rounded text-sm transition ${
                  chartType === 'line' ? 'bg-blue-500 text-white' : 'text-white/70 hover:text-white'
                }`}
              >
                📈 Line
              </button>
              <button
                onClick={() => changeChartType('scatter')}
                className={`px-3 py-1 rounded text-sm transition ${
                  chartType === 'scatter' ? 'bg-blue-500 text-white' : 'text-white/70 hover:text-white'
                }`}
              >
                ⚫ Scatter
              </button>
            </div>
          )}
        </div>
        
        <button
          onClick={() => {
            const chartId = generatePrefixedId('chart');
            addChart({
              id: chartId,
              type: 'echarts',
              data: { option: currentOption },
              timestamp: Date.now(),
            });
            setAddedToGallery(true);
            setTimeout(() => setAddedToGallery(false), 2000);
          }}
          className={`px-3 py-1 border rounded text-sm transition ${
            addedToGallery 
              ? 'bg-green-500/20 border-green-500/50 text-green-300' 
              : 'bg-primary/20 hover:bg-primary/30 border-primary/50 text-primary hover:text-primary/80'
          }`}
          disabled={addedToGallery}
        >
          {addedToGallery ? '✓ Added to Gallery' : '+ Add to Gallery'}
        </button>
      </div>

      {/* Chart Container */}
      <div 
        ref={chartRef} 
        style={{ 
          width: '100%', 
          height: '600px',
          ...style 
        }}
        role="img"
        aria-label={`Chart showing ${title || 'data visualization'}`}
        tabIndex={0}
      />
    </div>
  );
}

// Sanitize ECharts option to ensure no React elements and remove problematic formatters
function sanitizeEChartsOption(option: any): any {
  if (!option || typeof option !== 'object') return option;
  
  // Deep clone via JSON, removing functions including formatters
  let sanitized;
  try {
    sanitized = JSON.parse(JSON.stringify(option, (key, value) => {
      // Remove ALL formatter functions
      if (key === 'formatter') {
        return undefined;
      }
      // Remove function values
      if (typeof value === 'function') {
        return undefined;
      }
      return value;
    }));
  } catch (e) {
    console.error('❌ JSON clone failed:', e);
    return null;
  }
  
  // Recursively remove any React elements and formatters that survived
  const clean = (obj: any, path = 'root'): any => {
    if (!obj || typeof obj !== 'object') return obj;
    
    // Check for React element markers ($$typeof is the correct property name)
    if (obj.$$typeof || obj._owner || obj._store || (obj.props !== undefined && obj.type !== undefined)) {
      return undefined;
    }
    
    if (Array.isArray(obj)) {
      return obj.map((item, i) => clean(item, `${path}[${i}]`)).filter(item => item !== undefined);
    }
    
    const cleaned: any = {};
    for (const key in obj) {
      if (!obj.hasOwnProperty(key)) continue;
      
      // CRITICAL: Skip any formatter keys entirely
      if (key === 'formatter') {
        continue;
      }
      
      const cleanedValue = clean(obj[key], `${path}.${key}`);
      if (cleanedValue !== undefined) {
        cleaned[key] = cleanedValue;
      }
    }
    return cleaned;
  };
  
  const result = clean(sanitized);
  return result;
}

// Helper function to convert string numbers to actual numbers recursively
function convertStringNumbersToNumeric(value: any): any {
  if (value === null || value === undefined || typeof value === 'function') {
    return value;
  }
  
  if (typeof value === 'object' && (value.$$typeof || value._owner || value._store)) {
    return undefined;
  }
  
  if (Array.isArray(value)) {
    return value.map(item => convertStringNumbersToNumeric(item)).filter(item => item !== undefined);
  }
  
  if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
    return Number(value);
  }
  
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const converted: any = {};
    for (const key in value) {
      if (value.hasOwnProperty(key)) {
        const convertedValue = convertStringNumbersToNumeric(value[key]);
        if (convertedValue !== undefined) {
          converted[key] = convertedValue;
        }
    }
  }
  return converted;
  }
  
  return value;
}

// Convert chart data to ECharts format
function convertToECharts(data: any): EChartsOption | null {
  if (data.echarts_chart || data.echartsChart) {
    const chart = data.echarts_chart || data.echartsChart;
    if (chart && chart.option) {
      return convertStringNumbersToNumeric(chart.option);
    }
    if (chart && typeof chart === 'object') {
      return convertStringNumbersToNumeric(chart);
    }
  }

  if (data.plotly_chart || data.plotlyChart) {
    const chart = data.plotly_chart || data.plotlyChart;
    return convertPlotlyToECharts(chart);
  }

  const pieData = data.pieData || data.pie_data || data.pie_chart_data || data.pieChartData;
  if (pieData && Array.isArray(pieData) && pieData.length > 0) {
    const dataPoints = pieData.map((item: any) => ({
      value: item.value || item.count || 0,
      name: item.label || item.name || item.player || 'Unknown'
    }));
    return {
      title: { text: data.title || data.team || 'Pie Chart', left: 'center', textStyle: { color: '#fff' } },
      tooltip: { trigger: 'item' },
      legend: { orient: 'vertical', left: 'left', textStyle: { color: '#fff' } },
      series: [{
        type: 'pie',
        radius: '50%',
        data: dataPoints,
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
      }]
    };
  }

  const xSeries = data.x_series || data.xSeries;
  const ySeries = data.y_series || data.ySeries;
  if (xSeries && Array.isArray(xSeries) && xSeries.length > 0) {
    const firstX = xSeries[0];
    const isBarChart = typeof firstX === 'string' && ySeries && Array.isArray(ySeries);
      
      if (isBarChart) {
      return {
        title: { text: data.title || 'Bar Chart', left: 'center', textStyle: { color: '#fff' } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        xAxis: { type: 'category', data: xSeries, axisLabel: { color: '#fff' }, name: data.x_label || data.xLabel || 'Category', nameTextStyle: { color: '#fff' } },
        yAxis: { type: 'value', axisLabel: { color: '#fff' }, name: data.y_label || data.yLabel || 'Value', nameTextStyle: { color: '#fff' } },
        series: [{ type: 'bar', data: ySeries, itemStyle: { color: '#5470c6' } }]
      };
      } else {
      return {
        title: { text: data.title || 'Line Chart', left: 'center', textStyle: { color: '#fff' } },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: xSeries, axisLabel: { color: '#fff' }, name: data.x_label || data.xLabel || 'X Axis', nameTextStyle: { color: '#fff' } },
        yAxis: { type: 'value', axisLabel: { color: '#fff' }, name: data.y_label || data.yLabel || 'Y Axis', nameTextStyle: { color: '#fff' } },
        series: [{ type: 'line', data: ySeries, smooth: true, lineStyle: { color: '#5470c6', width: 2 }, itemStyle: { color: '#5470c6' } }]
      };
    }
  }

  const barData = data.barData || data.bar_chart_data || data.barChartData || data.histogramData;
  if (barData && Array.isArray(barData) && barData.length > 0) {
    const categories: string[] = [];
    const values: number[] = [];
    barData.forEach((item: any) => {
      categories.push(item.label || item.name || item.category || '');
      values.push(item.value || item.count || 0);
    });
    
    const isHistogram = data.histogramData || data.type === 'histogram';
    
    return {
      title: { text: data.title || data.team || (isHistogram ? 'Histogram' : 'Bar Chart'), left: 'center', textStyle: { color: '#fff' } },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: isHistogram ? 'value' : 'category', data: isHistogram ? undefined : categories, axisLabel: { color: '#fff' }, name: data.x_label || data.xLabel || (isHistogram ? 'Value' : 'Category'), nameTextStyle: { color: '#fff' } },
      yAxis: { type: isHistogram ? 'category' : 'value', data: isHistogram ? categories : undefined, axisLabel: { color: '#fff' }, name: data.y_label || data.yLabel || (isHistogram ? 'Category' : 'Value'), nameTextStyle: { color: '#fff' } },
      series: [{ type: 'bar', data: isHistogram ? categories.map((_, i) => values[i]) : values, itemStyle: { color: '#5470c6' } }]
    };
  }

  const scatterData = data.scatterData || data.scatter_chart_data || data.scatterChartData;
  if (scatterData && Array.isArray(scatterData) && scatterData.length > 0) {
    const points = scatterData.map((item: any) => [
      parseFloat(item.x || 0),
      parseFloat(item.y || 0),
      item.z ? parseFloat(item.z) : undefined
    ]);
    
    return {
      title: { text: data.title || 'Scatter Plot', left: 'center', textStyle: { color: '#fff' } },
      tooltip: { trigger: 'item' },
      xAxis: { type: 'value', axisLabel: { color: '#fff' }, name: data.x_label || data.xLabel || 'X', nameTextStyle: { color: '#fff' } },
      yAxis: { type: 'value', axisLabel: { color: '#fff' }, name: data.y_label || data.yLabel || 'Y', nameTextStyle: { color: '#fff' } },
      series: [{
        type: 'scatter',
        data: points,
        symbolSize: (data: any) => data[2] ? data[2] * 10 : 8,
        itemStyle: { color: '#5470c6', opacity: 0.8 }
      }]
    };
  }

  return null;
}

// Convert Plotly chart format to ECharts
function convertPlotlyToECharts(plotlyChart: any): EChartsOption | null {
  if (!plotlyChart || !plotlyChart.data || !Array.isArray(plotlyChart.data) || plotlyChart.data.length === 0) {
    return null;
  }

  const traces = plotlyChart.data;
  const layout = plotlyChart.layout || {};
  const title = typeof layout.title === 'string' ? layout.title : (layout.title?.text || 'Chart');
  const xAxisTitle = layout.xaxis?.title || layout.xAxis?.title || 'X Axis';
  const yAxisTitle = layout.yaxis?.title || layout.yAxis?.title || 'Y Axis';
  const series: any[] = [];
  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'];

  traces.forEach((trace: any, idx: number) => {
    const type = trace.type || 'line';
    const name = trace.name || `Series ${idx + 1}`;
    const color = trace.marker?.color || colors[idx % colors.length];

    switch (type) {
      case 'bar':
        series.push({ type: 'bar', name, data: trace.y || trace.x || [], itemStyle: { color } });
        break;
      case 'pie':
        series.push({
          type: 'pie',
          name,
          radius: '50%',
          data: (trace.labels || []).map((label: string, i: number) => ({ name: label, value: (trace.values || [])[i] || 0 })),
          emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
        });
        break;
      case 'scatter':
        series.push({
          type: 'scatter',
          name,
          data: (trace.x || []).map((x: any, i: number) => [x, (trace.y || [])[i]]),
          symbolSize: 8,
          itemStyle: { color, opacity: 0.8 }
        });
        break;
      case 'histogram':
        series.push({ type: 'bar', name, data: trace.x || [], itemStyle: { color } });
        break;
      default:
        series.push({
          type: 'line',
          name,
          data: trace.y || trace.x || [],
          smooth: true,
          lineStyle: { color, width: 2 },
          itemStyle: { color }
        });
    }
  });

    const option: EChartsOption = {
    title: { text: title, left: 'center', textStyle: { color: '#fff' } },
    tooltip: { trigger: series.some(s => s.type === 'pie') ? 'item' : 'axis' },
    legend: {
      data: series.map(s => s.name),
      textStyle: { color: '#fff' },
      top: series.some(s => s.type === 'pie') ? 'center' : 'top',
      left: series.some(s => s.type === 'pie') ? 'left' : 'center',
      orient: series.some(s => s.type === 'pie') ? 'vertical' : 'horizontal'
    },
    xAxis: series.some(s => s.type === 'pie') ? undefined : {
      type: traces[0]?.type === 'bar' ? 'category' : 'value',
      data: traces[0]?.x || undefined,
      axisLabel: { color: '#fff' },
      name: xAxisTitle,
      nameTextStyle: { color: '#fff' }
    },
    yAxis: series.some(s => s.type === 'pie') ? undefined : {
      type: 'value',
      axisLabel: { color: '#fff' },
      name: yAxisTitle,
      nameTextStyle: { color: '#fff' }
    },
    series
  };

  return option;
}

// Deep clone to remove React elements
function deepClone(obj: any): any {
  try {
    return JSON.parse(JSON.stringify(obj, (_key, value) => {
      if (value && typeof value === 'object') {
        if (value.$$typeof || value._owner || value._store || value._self || value._source) {
          return undefined;
        }
        if (value.props !== undefined && value.key !== undefined && value.type !== undefined) {
          if (typeof value.type === 'function' || typeof value.type === 'symbol') {
            return undefined;
          }
        }
        if (typeof value.type === 'function') {
          return undefined;
        }
      }
      if (typeof value === 'function') {
        return undefined;
      }
      return value;
    }));
  } catch (e) {
    console.error('Error in deepClone:', e);
    return null;
  }
}

function processChartData(data: any, chartComponents: JSX.Element[], keyPrefix: string = '', processedCharts?: Set<string>): void {
  if (!data || typeof data !== 'object') return;

  // Helper to create chart ID for deduplication
  const getChartId = (chartData: any): string => {
    try {
      const title = chartData?.option?.title?.text || chartData?.layout?.title || 'untitled';
      const seriesData = JSON.stringify(chartData?.option?.series || chartData?.data || []).substring(0, 100);
      return `${title}-${seriesData}`;
    } catch {
      return `chart-${Math.random()}`;
    }
  };

  // Check if this data directly contains a chart
  if (data.echarts_chart || data.echartsChart || data.plotly_chart || data.plotlyChart) {
    const chartData = data.echarts_chart || data.echartsChart || data.plotly_chart || data.plotlyChart;
    const chartId = getChartId(chartData);

    // Skip if already processed
    if (processedCharts && processedCharts.has(chartId)) return;

    const titleText = data.echarts_chart?.option?.title?.text ||
                      data.echartsChart?.option?.title?.text ||
                      data.plotly_chart?.layout?.title ||
                      data.plotlyChart?.layout?.title ||
                      'untitled';
    const chartKey = generatePrefixedId('chart');

    const cleanData = deepClone(data);
    if (!cleanData) return;

    let option = convertToECharts(cleanData);
    if (!option) return;

    // Sanitize to remove React elements (already does JSON.parse/stringify internally)
    const safeOption = sanitizeEChartsOption(option);
    if (!safeOption) return;

    const title = (safeOption as any).title?.text || data.title || keyPrefix || 'Chart';

    chartComponents.push(
      <div key={chartKey} className="my-4 p-4 bg-white/5 rounded-lg w-full border border-white/10">
        <DirectECharts option={safeOption} title={String(title)} />
      </div>
    );

    if (processedCharts) processedCharts.add(chartId);

    // Don't return - continue to check for more charts in nested properties
  }

  // Try to convert the data itself to a chart
  const converted = convertToECharts(data);
  if (converted) {
    const chartId = getChartId({ option: converted });

    // Skip if already processed
    if (processedCharts && processedCharts.has(chartId)) return;

    const chartKey = `${keyPrefix}-converted-${Date.now()}-${Math.random()}`;

    // Sanitize to remove React elements (already does JSON.parse/stringify internally)
    const safeOption = sanitizeEChartsOption(converted);
    if (safeOption) {
      const title = (safeOption as any).title?.text || data.title || keyPrefix || 'Chart';

      chartComponents.push(
        <div key={chartKey} className="my-4 p-4 bg-white/5 rounded-lg w-full border border-white/10">
          <DirectECharts option={safeOption} title={String(title)} />
        </div>
      );

      if (processedCharts) {
        processedCharts.add(chartId);
      }
    }

    // Don't return - continue to check for more charts in nested properties
  }

  // Recursively search for charts in nested objects
  if (!Array.isArray(data)) {
    for (const key in data) {
      const nestedData = data[key];
      if (nestedData && typeof nestedData === 'object') {
        // Always recurse into nested objects to find charts at any depth
        // This handles cases like { graph_modes: { echarts_chart: {...} } }
        const clonedNestedData = deepClone(nestedData);
        if (clonedNestedData) {
          processChartData(clonedNestedData, chartComponents, key, processedCharts);
        }
      }
    }
  }
}

export function ChartRenderer({ content, executionResults }: ChartRendererProps) {
  const charts = useMemo(() => {
    try {
      const chartComponents: JSX.Element[] = [];
      const processedCharts = new Set<string>(); // Track processed charts to avoid duplicates

      // Helper to create unique chart identifier
      const getChartId = (data: any): string => {
        try {
          // Create a stable identifier based on chart data
          const chartData = data.echarts_chart || data.echartsChart || data.plotly_chart || data.plotlyChart || data;
          const title = chartData?.option?.title?.text || chartData?.layout?.title || 'untitled';
          const seriesData = JSON.stringify(chartData?.option?.series || chartData?.data || []).substring(0, 100);
          return `${title}-${seriesData}`;
        } catch {
          return `chart-${Math.random()}`;
        }
      };

      // Process execution results first (highest priority)
      if (executionResults) {
        try {
          let data = typeof executionResults === 'string' ? JSON.parse(executionResults) : executionResults;

          if (data && typeof data === 'object') {
            // Use the recursive processChartData which will find ALL charts
            processChartData(data, chartComponents, 'execution', processedCharts);
          }
        } catch (e) {
          console.error('ChartRenderer: Error parsing executionResults:', e);
        }
      }

      // Disable content scanning - only use executionResults
      // This prevents excessive searching and improves performance

      return chartComponents;
    } catch (error) {
      console.error('Error processing charts:', error);
      return [];
    }
  }, [content, executionResults]);

  return <>{charts}</>;
}