export type ColorScheme = 'dark' | 'light' | 'blue' | 'green' | 'purple' | 'orange' | 'custom';

export interface Theme {
  name: string;
  colors: {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    popover: string;
    popoverForeground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    destructive: string;
    destructiveForeground: string;
    border: string;
    input: string;
    ring: string;
    chatBg: string;
    chatSidebar: string;
    chatUserMessage: string;
    chatAssistantMessage: string;
    chatAssistantAvatar: string;
    chatHover: string;
  };
}

export const themes: Record<ColorScheme, Theme> = {
  dark: {
    name: 'Dark',
    colors: {
      background: '217 19% 27%',
      foreground: '0 0% 95%',
      card: '217 19% 27%',
      cardForeground: '0 0% 95%',
      popover: '217 19% 27%',
      popoverForeground: '0 0% 95%',
      primary: '142 70% 45%',
      primaryForeground: '0 0% 100%',
      secondary: '217 33% 17%',
      secondaryForeground: '0 0% 95%',
      muted: '217 33% 17%',
      mutedForeground: '0 0% 65%',
      accent: '142 70% 45%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '217 19% 20%',
      input: '217 33% 17%',
      ring: '142 70% 45%',
      chatBg: '217 19% 27%',
      chatSidebar: '217 33% 17%',
      chatUserMessage: '142 70% 45%',
      chatAssistantMessage: '217 19% 35%',
      chatAssistantAvatar: '142 70% 45%',
      chatHover: '217 19% 32%',
    },
  },
  light: {
    name: 'Light',
    colors: {
      background: '0 0% 100%',
      foreground: '0 0% 10%',
      card: '0 0% 100%',
      cardForeground: '0 0% 10%',
      popover: '0 0% 100%',
      popoverForeground: '0 0% 10%',
      primary: '142 70% 35%',
      primaryForeground: '0 0% 100%',
      secondary: '0 0% 96%',
      secondaryForeground: '0 0% 10%',
      muted: '0 0% 96%',
      mutedForeground: '0 0% 40%',
      accent: '142 70% 35%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '0 0% 90%',
      input: '0 0% 96%',
      ring: '142 70% 35%',
      chatBg: '0 0% 100%',
      chatSidebar: '0 0% 98%',
      chatUserMessage: '142 70% 35%',
      chatAssistantMessage: '0 0% 97%',
      chatAssistantAvatar: '142 70% 35%',
      chatHover: '0 0% 95%',
    },
  },
  blue: {
    name: 'Blue',
    colors: {
      background: '217 32% 17%',
      foreground: '0 0% 95%',
      card: '217 32% 17%',
      cardForeground: '0 0% 95%',
      popover: '217 32% 17%',
      popoverForeground: '0 0% 95%',
      primary: '217 91% 60%',
      primaryForeground: '0 0% 100%',
      secondary: '217 32% 12%',
      secondaryForeground: '0 0% 95%',
      muted: '217 32% 12%',
      mutedForeground: '0 0% 65%',
      accent: '217 91% 60%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '217 32% 25%',
      input: '217 32% 12%',
      ring: '217 91% 60%',
      chatBg: '217 32% 17%',
      chatSidebar: '217 32% 12%',
      chatUserMessage: '217 91% 60%',
      chatAssistantMessage: '217 32% 22%',
      chatAssistantAvatar: '217 91% 60%',
      chatHover: '217 32% 20%',
    },
  },
  green: {
    name: 'Green',
    colors: {
      background: '142 19% 27%',
      foreground: '0 0% 95%',
      card: '142 19% 27%',
      cardForeground: '0 0% 95%',
      popover: '142 19% 27%',
      popoverForeground: '0 0% 95%',
      primary: '142 70% 45%',
      primaryForeground: '0 0% 100%',
      secondary: '142 33% 17%',
      secondaryForeground: '0 0% 95%',
      muted: '142 33% 17%',
      mutedForeground: '0 0% 65%',
      accent: '142 70% 45%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '142 19% 20%',
      input: '142 33% 17%',
      ring: '142 70% 45%',
      chatBg: '142 19% 27%',
      chatSidebar: '142 33% 17%',
      chatUserMessage: '142 70% 45%',
      chatAssistantMessage: '142 19% 35%',
      chatAssistantAvatar: '142 70% 45%',
      chatHover: '142 19% 32%',
    },
  },
  purple: {
    name: 'Purple',
    colors: {
      background: '270 19% 27%',
      foreground: '0 0% 95%',
      card: '270 19% 27%',
      cardForeground: '0 0% 95%',
      popover: '270 19% 27%',
      popoverForeground: '0 0% 95%',
      primary: '270 70% 60%',
      primaryForeground: '0 0% 100%',
      secondary: '270 33% 17%',
      secondaryForeground: '0 0% 95%',
      muted: '270 33% 17%',
      mutedForeground: '0 0% 65%',
      accent: '270 70% 60%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '270 19% 20%',
      input: '270 33% 17%',
      ring: '270 70% 60%',
      chatBg: '270 19% 27%',
      chatSidebar: '270 33% 17%',
      chatUserMessage: '270 70% 60%',
      chatAssistantMessage: '270 19% 35%',
      chatAssistantAvatar: '270 70% 60%',
      chatHover: '270 19% 32%',
    },
  },
  orange: {
    name: 'Orange',
    colors: {
      background: '25 19% 27%',
      foreground: '0 0% 95%',
      card: '25 19% 27%',
      cardForeground: '0 0% 95%',
      popover: '25 19% 27%',
      popoverForeground: '0 0% 95%',
      primary: '25 95% 53%',
      primaryForeground: '0 0% 100%',
      secondary: '25 33% 17%',
      secondaryForeground: '0 0% 95%',
      muted: '25 33% 17%',
      mutedForeground: '0 0% 65%',
      accent: '25 95% 53%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '25 19% 20%',
      input: '25 33% 17%',
      ring: '25 95% 53%',
      chatBg: '25 19% 27%',
      chatSidebar: '25 33% 17%',
      chatUserMessage: '25 95% 53%',
      chatAssistantMessage: '25 19% 35%',
      chatAssistantAvatar: '25 95% 53%',
      chatHover: '25 19% 32%',
    },
  },
  custom: {
    name: 'Custom',
    colors: {
      background: '217 19% 27%',
      foreground: '0 0% 95%',
      card: '217 19% 27%',
      cardForeground: '0 0% 95%',
      popover: '217 19% 27%',
      popoverForeground: '0 0% 95%',
      primary: '142 70% 45%',
      primaryForeground: '0 0% 100%',
      secondary: '217 33% 17%',
      secondaryForeground: '0 0% 95%',
      muted: '217 33% 17%',
      mutedForeground: '0 0% 65%',
      accent: '142 70% 45%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '217 19% 20%',
      input: '217 33% 17%',
      ring: '142 70% 45%',
      chatBg: '217 19% 27%',
      chatSidebar: '217 33% 17%',
      chatUserMessage: '142 70% 45%',
      chatAssistantMessage: '217 19% 35%',
      chatAssistantAvatar: '142 70% 45%',
      chatHover: '217 19% 32%',
    },
  },
};

const THEME_STORAGE_KEY = 'color-scheme';
const CUSTOM_COLORS_KEY = 'custom-theme-colors';

export function getStoredTheme(): ColorScheme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return (stored as ColorScheme) || 'dark';
}

export function setStoredTheme(theme: ColorScheme): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function getCustomColors(): { primary: string; secondary: string; accent: string } {
  if (typeof window === 'undefined') return { primary: '#10b981', secondary: '#3b4252', accent: '#10b981' };
  const stored = localStorage.getItem(CUSTOM_COLORS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      return { primary: '#10b981', secondary: '#3b4252', accent: '#10b981' };
    }
  }
  return { primary: '#10b981', secondary: '#3b4252', accent: '#10b981' };
}

export function setCustomColors(colors: { primary: string; secondary: string; accent: string }): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
  
  // Update custom theme colors
  const customTheme = themes.custom;
  const primaryHSL = hexToHSL(colors.primary);
  const secondaryHSL = hexToHSL(colors.secondary);
  const accentHSL = hexToHSL(colors.accent);
  
  // Primary color - buttons and interactive elements
  customTheme.colors.primary = primaryHSL;
  customTheme.colors.ring = primaryHSL;
  customTheme.colors.chatUserMessage = primaryHSL;
  customTheme.colors.chatAssistantAvatar = primaryHSL;
  
  // Secondary color - sidebar and inputs
  customTheme.colors.secondary = secondaryHSL;
  customTheme.colors.chatSidebar = secondaryHSL;
  customTheme.colors.input = secondaryHSL;
  customTheme.colors.muted = secondaryHSL;
  
  // Accent color - main backgrounds (chat bg, app background)
  customTheme.colors.accent = accentHSL;
  customTheme.colors.background = accentHSL;
  customTheme.colors.chatBg = accentHSL;
  customTheme.colors.card = accentHSL;
  customTheme.colors.popover = accentHSL;
  
  // Auto-calculate darker shades for assistant message and hover
  // Parse the HSL to adjust lightness for contrast
  const accentParts = accentHSL.match(/(\d+)\s+(\d+)%\s+(\d+)%/);
  if (accentParts) {
    const h = accentParts[1];
    const s = accentParts[2];
    const l = parseInt(accentParts[3]);
    // Assistant message: slightly lighter than background
    const assistantL = Math.min(l + 8, 95);
    // Hover: slightly lighter than assistant
    const hoverL = Math.min(l + 12, 95);
    customTheme.colors.chatAssistantMessage = `${h} ${s}% ${assistantL}%`;
    customTheme.colors.chatHover = `${h} ${s}% ${hoverL}%`;
  }
}

function hexToHSL(hex: string): string {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  
  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);
  
  return `${h} ${s}% ${l}%`;
}

export function applyTheme(theme: ColorScheme): void {
  if (typeof document === 'undefined') return;
  
  // Load custom colors if custom theme
  if (theme === 'custom') {
    const customColors = getCustomColors();
    setCustomColors(customColors);
  }
  
  const themeColors = themes[theme].colors;
  const root = document.documentElement;
  
  root.style.setProperty('--background', themeColors.background);
  root.style.setProperty('--foreground', themeColors.foreground);
  root.style.setProperty('--card', themeColors.card);
  root.style.setProperty('--card-foreground', themeColors.cardForeground);
  root.style.setProperty('--popover', themeColors.popover);
  root.style.setProperty('--popover-foreground', themeColors.popoverForeground);
  root.style.setProperty('--primary', themeColors.primary);
  root.style.setProperty('--primary-foreground', themeColors.primaryForeground);
  root.style.setProperty('--secondary', themeColors.secondary);
  root.style.setProperty('--secondary-foreground', themeColors.secondaryForeground);
  root.style.setProperty('--muted', themeColors.muted);
  root.style.setProperty('--muted-foreground', themeColors.mutedForeground);
  root.style.setProperty('--accent', themeColors.accent);
  root.style.setProperty('--accent-foreground', themeColors.accentForeground);
  root.style.setProperty('--destructive', themeColors.destructive);
  root.style.setProperty('--destructive-foreground', themeColors.destructiveForeground);
  root.style.setProperty('--border', themeColors.border);
  root.style.setProperty('--input', themeColors.input);
  root.style.setProperty('--ring', themeColors.ring);
  root.style.setProperty('--chat-bg', themeColors.chatBg);
  root.style.setProperty('--chat-sidebar', themeColors.chatSidebar);
  root.style.setProperty('--chat-user-message', themeColors.chatUserMessage);
  root.style.setProperty('--chat-assistant-message', themeColors.chatAssistantMessage);
  root.style.setProperty('--chat-assistant-avatar', themeColors.chatAssistantAvatar);
  root.style.setProperty('--chat-hover', themeColors.chatHover);
}

// Initialize theme on load
if (typeof window !== 'undefined') {
  const storedTheme = getStoredTheme();
  applyTheme(storedTheme);
}

