import { getApiKey, getProviderForModel } from "./apiKeys";
import { Message } from "@/types/chat";

// Base API call interface
interface ApiCallOptions {
  prompt: string;
  model: string;
  images?: string[]; // Base64 image data URLs
  conversationHistory?: Message[]; // For preserving reasoning_details
  reasoningEnabled?: boolean; // Whether to enable reasoning for reasoning models
  onDelta: (chunk: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

// OpenRouter API implementation (primary)
async function callOpenRouterApi(options: ApiCallOptions) {
  const { prompt, model, images, conversationHistory, reasoningEnabled = false, onDelta, onDone, onError } = options;
  const provider = getProviderForModel(model);
  if (!provider) throw new Error('No provider found for model');
  
  const apiKey = getApiKey(provider.id);
  if (!apiKey) throw new Error('No API key found');

  try {
    // Check if model supports reasoning (models with "think" or "reasoning" in name)
    const supportsReasoning = model.includes('sherlock-think') || model.includes('think') || model.includes('deepseek-r1');
    // Check if model supports vision (sherlock models support vision)
    const supportsVision = model.includes('sherlock-dash') || model.includes('sherlock-think');
    
    // Build messages array, preserving reasoning_details from previous messages
    const messages: any[] = [];
    
    if (conversationHistory && conversationHistory.length > 0) {
      // Convert conversation history to OpenRouter format, preserving reasoning_details
      for (const msg of conversationHistory) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          const messageObj: any = {
            role: msg.role,
            content: msg.content
          };
          
          // Preserve images from previous user messages if present
          if (msg.role === 'user' && msg.images && msg.images.length > 0 && supportsVision) {
            // Convert to multi-modal format
            const contentArray: any[] = [];
            // Add text content
            if (msg.content) {
              contentArray.push({ type: 'text', text: msg.content });
            }
            // Add images
            for (const imageUrl of msg.images) {
              if (imageUrl.startsWith('data:')) {
                contentArray.push({
                  type: 'image_url',
                  image_url: { url: imageUrl }
                });
              }
            }
            messageObj.content = contentArray;
          }
          
          // Preserve reasoning_details if present (from previous assistant messages)
          if (msg.role === 'assistant' && (msg as any).reasoning_details) {
            messageObj.reasoning_details = (msg as any).reasoning_details;
          }
          
          messages.push(messageObj);
        }
      }
    }
    
    // Build current user message with images if supported
    let userMessageContent: any;
    if (images && images.length > 0 && supportsVision) {
      // Multi-modal message with images
      userMessageContent = [
        { type: 'text', text: prompt }
      ];
      // Add images
      for (const imageUrl of images) {
        if (imageUrl.startsWith('data:')) {
          userMessageContent.push({
            type: 'image_url',
            image_url: { url: imageUrl }
          });
        }
      }
    } else {
      // Text-only message
      userMessageContent = prompt;
    }
    
    // Add current user message
    messages.push({
      role: 'user',
      content: userMessageContent
    });

    // Determine max_tokens based on model capabilities
    // Different models have different total context limits
    // We set max_tokens to leave room for input (typically 60-70% of total for output)
    let maxTokens = 1500000; // Default high limit for main models
    
    // Model-specific context limits (total context window) - loaded dynamically
    const { getModelContextLimitsMap } = await import('./openRouterModels');
    const modelContextLimits = getModelContextLimitsMap();
    
    // Check for exact model match first
    if (modelContextLimits[model]) {
      const totalContext = modelContextLimits[model];
      // Reserve 40% for input, use 60% for output (more input capacity)
      maxTokens = Math.floor(totalContext * 0.6);
    } else {
      // Fallback: check for partial matches (case-insensitive)
      const modelLower = model.toLowerCase();
      if (modelLower.includes('grok-4.1-fast') || modelLower.includes('x-ai/grok-4.1-fast')) {
        // Grok 4.1 Fast: 2M context
        maxTokens = 1200000; // ~60% of 2M (800K for input)
      } else if (modelLower.includes('qwen3-coder') || modelLower.includes('qwen/qwen3-coder')) {
        // Qwen3 Coder: 262k context
        maxTokens = 157000; // ~60% of 262k
      } else if (modelLower.includes('kat-coder') || modelLower.includes('kwaipilot/kat-coder')) {
        // Kat Coder Pro: 256k context
        maxTokens = 154000; // ~60% of 256k
      } else if (modelLower.includes('deepseek-r1t2-chimera') || modelLower.includes('tngtech/deepseek-r1t2-chimera')) {
        // DeepSeek R1T2 Chimera: 164k context
        maxTokens = 98000; // ~60% of 164k
      } else if (modelLower.includes('glm-4.5-air') || modelLower.includes('z-ai/glm-4.5-air')) {
        // GLM 4.5 Air: 131k context
        maxTokens = 79000; // ~60% of 131k
      } else if (modelLower.includes('deepseek-r1') || modelLower.includes('r1t2')) {
        // Other DeepSeek R1 models: typically 128k-164k context
        maxTokens = 100000; // Conservative limit
      } else if (modelLower.includes('glm-4.5') || modelLower.includes('glm-4')) {
        // Other GLM models: typically 128k-131k context
        maxTokens = 80000; // Conservative limit
      } else if (modelLower.includes('coder')) {
        // Generic code models: limit to 100k output tokens (leaving ~162k for input)
        // This ensures we stay under typical 262k total context limit
      maxTokens = 100000;
      }
    }
    
    const requestBody: any = {
      model: model,
      messages: messages,
      stream: true, // Always stream for better UX
      max_tokens: maxTokens
    };

    // Add reasoning if supported and enabled
    if (supportsReasoning && reasoningEnabled) {
      requestBody.reasoning = { enabled: true };
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin, // Optional: for analytics
        'X-Title': 'Volleyball Analytics AI' // Optional: for analytics
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorData = await response.json();
        // OpenRouter error format: { error: { message: "...", type: "...", code: "..." } }
        if (errorData.error) {
          errorMessage = errorData.error.message || errorData.error.type || errorMessage;
          // Include additional error details if available
          if (errorData.error.code) {
            errorMessage += ` (${errorData.error.code})`;
          }
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch (e) {
        // If JSON parsing fails, try to get text
        const text = await response.text().catch(() => '');
        if (text) {
          errorMessage = text.substring(0, 200); // Limit error message length
        }
      }
      throw new Error(errorMessage);
    }

    // Handle streaming response
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';
    let reasoningDetails: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '' || line.trim() === '[DONE]') continue;
        
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          try {
            const json = JSON.parse(data);
            
            // Handle error messages in streaming response
            if (json.error) {
              const errorMsg = json.error.message || json.error.type || 'API error during streaming';
              throw new Error(errorMsg);
            }
            
            // Handle content deltas
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              onDelta(content);
            }
            
            // Check for finish_reason to detect truncation
            const finishReason = json.choices?.[0]?.finish_reason;
            if (finishReason === 'length') {
              console.error('⚠️ Response was truncated due to token limit! finish_reason: length');
              // Still continue processing what we got, but log the issue
            } else if (finishReason) {
              console.log('Response finished with reason:', finishReason);
            }
            
            // Handle final message with reasoning_details (for reasoning models)
            const finalMessage = json.choices?.[0]?.message;
            if (finalMessage?.reasoning_details) {
              reasoningDetails = finalMessage.reasoning_details;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
    
    // Store reasoning_details if present (will be preserved in next request via conversation history)
    if (reasoningDetails) {
      // Store temporarily to be picked up by the message handler
      (window as any).__lastReasoningDetails = reasoningDetails;
    }

    onDone();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    onError(errorMessage);
  }
}

// Gemini API implementation (legacy - for direct Gemini access if needed)
async function callGeminiApi(options: ApiCallOptions) {
  const { prompt, model, onDelta, onDone, onError } = options;
  const provider = getProviderForModel(model);
  if (!provider) throw new Error('No provider found for model');
  
  const apiKey = getApiKey(provider.id);
  if (!apiKey) throw new Error('No API key found');

  try {
    // Map model ID to Gemini API model name
    const geminiModel = model === 'gemini-2.5-flash' ? 'gemini-2.5-flash' : 'gemini-2.0-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${apiKey}`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullResponse += decoder.decode(value, { stream: true });
    }

    const data = JSON.parse(fullResponse);
    let candidates = null;

    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.candidates) {
          candidates = item.candidates;
          break;
        }
      }
    } else if (data.candidates) {
      candidates = data.candidates;
    } else if (typeof data === 'object') {
      for (const key of Object.keys(data)) {
        const value = data[key];
        if (value?.candidates) {
          candidates = value.candidates;
          break;
        } else if (value?.content?.parts) {
          candidates = [value];
          break;
        }
      }
    }

    if (candidates && candidates.length > 0) {
      const candidate = candidates[0];
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) {
            onDelta(part.text);
          }
        }
      }
    } else if (data.error) {
      throw new Error(data.error.message || 'API error');
    } else {
      throw new Error('Unexpected response format');
    }

    onDone();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    onError(errorMessage);
  }
}

// OpenAI API implementation
async function callOpenAIApi(options: ApiCallOptions) {
  const { prompt, model, onDelta, onDone, onError } = options;
  const provider = getProviderForModel(model);
  if (!provider) throw new Error('No provider found for model');
  
  const apiKey = getApiKey(provider.id);
  if (!apiKey) throw new Error('No API key found');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        stream: true
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              onDelta(content);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    onDone();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    onError(errorMessage);
  }
}

// Anthropic API implementation
async function callAnthropicApi(options: ApiCallOptions) {
  const { prompt, model, onDelta, onDone, onError } = options;
  const provider = getProviderForModel(model);
  if (!provider) throw new Error('No provider found for model');
  
  const apiKey = getApiKey(provider.id);
  if (!apiKey) throw new Error('No API key found');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1500000, // Fixed high limit (1.5M tokens) - API will enforce actual max if exceeded
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const json = JSON.parse(data);
            if (json.type === 'content_block_delta') {
              const text = json.delta?.text;
              if (text) {
                onDelta(text);
              }
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    onDone();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    onError(errorMessage);
  }
}

// DeepSeek API implementation
async function callDeepSeekApi(options: ApiCallOptions) {
  const { prompt, model, onDelta, onDone, onError } = options;
  const provider = getProviderForModel(model);
  if (!provider) throw new Error('No provider found for model');
  
  const apiKey = getApiKey(provider.id);
  if (!apiKey) throw new Error('No API key found');

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        stream: true
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              onDelta(content);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    onDone();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    onError(errorMessage);
  }
}

// Main API router
export async function callApi(options: ApiCallOptions) {
  const { model } = options;
  const provider = getProviderForModel(model);
  
  if (!provider) {
    options.onError(`No API provider configured for model: ${model}`);
    return;
  }

  const apiKey = getApiKey(provider.id);
  if (!apiKey) {
    options.onError(`No API key found for ${provider.name}. Please add it in Settings.`);
    return;
  }

  // Route to appropriate API based on provider
  switch (provider.id) {
    case 'openrouter':
      await callOpenRouterApi(options);
      break;
    case 'gemini':
      await callGeminiApi(options);
      break;
    case 'openai':
      await callOpenAIApi(options);
      break;
    case 'anthropic':
      await callAnthropicApi(options);
      break;
    case 'deepseek':
      await callDeepSeekApi(options);
      break;
    default:
      options.onError(`API implementation not yet available for ${provider.name}`);
  }
}

