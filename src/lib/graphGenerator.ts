// Graph generation using Puter's txt2img API

declare global {
  interface Window {
    puter?: any;
  }
}

export interface GraphData {
  type: 'bar' | 'line' | 'pie' | 'scatter';
  title: string;
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color?: string;
  }[];
}

// Generate a graph description for txt2img
function generateGraphDescription(data: GraphData): string {
  let description = `Create a ${data.type} chart titled "${data.title}". `;
  
  if (data.type === 'bar' || data.type === 'line') {
    description += `X-axis labels: ${data.labels.join(', ')}. `;
    data.datasets.forEach((dataset, idx) => {
      description += `${dataset.label}: ${dataset.data.join(', ')}. `;
    });
  } else if (data.type === 'pie') {
    description += `Categories and values: `;
    data.labels.forEach((label, idx) => {
      const value = data.datasets[0]?.data[idx] || 0;
      description += `${label} (${value}), `;
    });
  }
  
  description += `Make it professional, clear, and easy to read with proper labels and colors.`;
  
  return description;
}

// Generate graph image using Puter's txt2img
export async function generateGraphImage(data: GraphData): Promise<string> {
  if (!window.puter) {
    throw new Error("Puter SDK not loaded");
  }

  try {
    const description = generateGraphDescription(data);
    
    // Use Puter's txt2img API
    const image = await window.puter.ai.txt2img(description, {
      model: "gpt-image-1",
      quality: "high"
    });

    // Convert the image element to a data URL
    if (image instanceof HTMLImageElement) {
      return new Promise((resolve, reject) => {
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.width || 800;
          canvas.height = image.height || 600;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(image, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } else {
            reject(new Error('Could not get canvas context'));
          }
        };
        image.onerror = () => reject(new Error('Image failed to load'));
        // If already loaded
        if (image.complete) {
          image.onload(null as any);
        }
      });
    }

    // If it's already a URL or data URL, return it
    if (typeof image === 'string') {
      return image;
    }

    throw new Error('Unexpected image format from txt2img');
  } catch (error) {
    console.error('Error generating graph:', error);
    throw error;
  }
}

// Generate graph from AI description text
export async function generateGraphFromDescription(description: string): Promise<string> {
  if (!window.puter) {
    throw new Error("Puter SDK not loaded");
  }

  try {
    // Enhance the description for better graph generation
    const enhancedDescription = `Create a professional data visualization chart: ${description}. Make it clear, well-labeled, with proper colors and formatting.`;
    
    const image = await window.puter.ai.txt2img(enhancedDescription, {
      model: "gpt-image-1",
      quality: "high"
    });

    // Convert the image element to a data URL
    if (image instanceof HTMLImageElement) {
      return new Promise((resolve, reject) => {
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.width || 800;
          canvas.height = image.height || 600;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(image, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } else {
            reject(new Error('Could not get canvas context'));
          }
        };
        image.onerror = () => reject(new Error('Image failed to load'));
        // If already loaded
        if (image.complete) {
          image.onload(null as any);
        }
      });
    }

    // If it's already a URL or data URL, return it
    if (typeof image === 'string') {
      return image;
    }

    throw new Error('Unexpected image format from txt2img');
  } catch (error) {
    console.error('Error generating graph from description:', error);
    throw error;
  }
}

// Parse graph request from AI response
export function parseGraphRequest(text: string): GraphData | null {
  // Look for patterns like "create a graph", "generate a chart", etc.
  const graphKeywords = /(?:create|generate|make|draw|show)\s+(?:a|an)?\s*(?:graph|chart|plot|visualization)/i;
  
  if (!graphKeywords.test(text)) {
    return null;
  }

  // Try to extract data from the text
  // This is a simple parser - you might want to enhance it
  // For now, return null and let the AI describe what graph to create
  return null;
}

