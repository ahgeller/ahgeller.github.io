import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Types for our store
interface Chart {
  id: string;
  type: string;
  data: any;
  timestamp: number;
  messageIndex?: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  executionResults?: any[];
}

interface AppState {
  // ===== DATA STATE =====
  csvData: any[];
  charts: Chart[];
  messages: Message[];
  currentCsvFileName: string | null;
  
  // ===== UI STATE =====
  showChartGallery: boolean;
  isLoading: boolean;
  
  // ===== CSV DATA ACTIONS =====
  setCsvData: (data: any[]) => void;
  clearCsvData: () => void;
  setCurrentCsvFileName: (name: string | null) => void;
  
  // ===== CHART ACTIONS =====
  addChart: (chart: Chart) => void;
  updateChart: (chartId: string, updates: Partial<Chart>) => void;
  deleteChart: (chartId: string) => void;
  clearCharts: () => void;
  
  // ===== MESSAGE ACTIONS =====
  addMessage: (message: Message) => void;
  updateMessage: (index: number, updates: Partial<Message>) => void;
  clearMessages: () => void;
  setMessages: (messages: Message[]) => void;
  
  // ===== UI ACTIONS =====
  setShowChartGallery: (show: boolean) => void;
  setIsLoading: (loading: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // ===== INITIAL STATE =====
      csvData: [],
      charts: [],
      messages: [],
      currentCsvFileName: null,
      showChartGallery: false,
      isLoading: false,
      
      // ===== CSV DATA ACTIONS =====
      setCsvData: (data) => set({ csvData: data }),
      
      clearCsvData: () => set({ 
        csvData: [], 
        currentCsvFileName: null 
      }),
      
      setCurrentCsvFileName: (name) => set({ 
        currentCsvFileName: name 
      }),
      
      // ===== CHART ACTIONS =====
      addChart: (chart) => set((state) => {
        // Check for duplicates based on chart data (not just ID)
        const isDuplicate = state.charts.some(existingChart => {
          // Compare by title and series data
          const existingTitle = existingChart.data?.option?.title?.text || '';
          const newTitle = chart.data?.option?.title?.text || '';
          const existingSeries = JSON.stringify(existingChart.data?.option?.series || []);
          const newSeries = JSON.stringify(chart.data?.option?.series || []);
          
          return existingTitle === newTitle && existingSeries === newSeries;
        });
        
        if (isDuplicate) {
          console.log('Duplicate chart detected, not adding');
          return state; // Don't add duplicate
        }
        
        return { charts: [...state.charts, chart] };
      }),
      
      updateChart: (chartId, updates) => set((state) => ({
        charts: state.charts.map(c => 
          c.id === chartId ? { ...c, ...updates } : c
        )
      })),
      
      deleteChart: (chartId) => set((state) => ({ 
        charts: state.charts.filter(c => c.id !== chartId) 
      })),
      
      clearCharts: () => set({ charts: [] }),
      
      // ===== MESSAGE ACTIONS =====
      addMessage: (message) => set((state) => ({ 
        messages: [...state.messages, message] 
      })),
      
      updateMessage: (index, updates) => set((state) => ({
        messages: state.messages.map((msg, i) => 
          i === index ? { ...msg, ...updates } : msg
        )
      })),
      
      clearMessages: () => set({ messages: [] }),
      
      setMessages: (messages) => set({ messages }),
      
      // ===== UI ACTIONS =====
      setShowChartGallery: (show) => set({ showChartGallery: show }),
      
      setIsLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'data-analyst-storage', // localStorage key
      // Only persist certain parts (not UI state)
      partialPersist: true,
      partialize: (state) => ({
        charts: state.charts,
        // Don't persist: csvData (too large), messages (too large), UI state
      }),
    }
  )
);

// Selector helpers for better performance
export const useCharts = () => useAppStore((state) => state.charts);
export const useCsvData = () => useAppStore((state) => state.csvData);
export const useMessages = () => useAppStore((state) => state.messages);
