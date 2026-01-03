import { getApiKey, getProviderForModel } from "./apiKeys";
import { Message } from "@/types/chat";

// Default API timeout (2 minutes - APIs can be slow for complex queries)
const API_TIMEOUT_MS = 120000;

// Create an AbortSignal that times out after the specified duration
// and optionally combines with an existing signal
function createTimeoutSignal(timeoutMs: number = API_TIMEOUT_MS, existingSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  
  // Set timeout to abort
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs / 1000}s`));
  }, timeoutMs);
  
  // If there's an existing signal, abort when it aborts
  if (existingSignal) {
    existingSignal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort(existingSignal.reason);
    });
  }
  
  // Clean up timeout when aborted (by either timeout or existing signal)
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
  });
  
  return controller.signal;
}

// Base API call interface
interface ApiCallOptions {
  prompt: string;
  model: string;
  images?: string[]; // Base64 image data URLs
  conversationHistory?: Message[]; // For preserving reasoning_details
  reasoningEnabled?: boolean; // Whether to enable reasoning for reasoning models
  signal?: AbortSignal; // Abort signal for canceling requests
  onDelta: (chunk: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

// OpenRouter API implementation (primary)
async function callOpenRouterApi(options: ApiCallOptions) {
  // Removed all text formatting helpers - no longer needed since we use LangChain messages directly

  const { prompt, model, images, conversationHistory, reasoningEnabled = false, onDelta, onDone, onError } = options;
  const provider = getProviderForModel(model);
  if (!provider) throw new Error('No provider found for model');

  const apiKey = getApiKey(provider.id);
  if (!apiKey) throw new Error('No API key found');

  // Batch delta calls to reduce UI updates (improves performance)
  let deltaBuffer = '';
  let deltaTimeout: NodeJS.Timeout | null = null;
  const BATCH_DELAY_MS = 50; // Batch deltas every 50ms

  const flushDeltaBuffer = () => {
    if (deltaBuffer) {
      onDelta(deltaBuffer);
      deltaBuffer = '';
    }
    deltaTimeout = null;
  };

  const batchedOnDelta = (chunk: string) => {
    deltaBuffer += chunk;

    // Clear existing timeout
    if (deltaTimeout) {
      clearTimeout(deltaTimeout);
    }

    // Set new timeout to flush buffer
    deltaTimeout = setTimeout(flushDeltaBuffer, BATCH_DELAY_MS);
  };

  try {
    // Check if model supports reasoning (models with "think" or "reasoning" in name)
    const supportsReasoning = model.includes('sherlock-think') || model.includes('think') || model.includes('deepseek-r1');
    // Check if model supports vision - most modern models support vision
    // Exclude models that explicitly don't support vision (text-only/code-only models)
    const isTextOnlyModel = model.includes('deepseek-r1') || model.includes('deepseek-chat') ||
                           model.includes('qwen') && model.includes('coder') ||
                           model.includes('kat-coder') ||
                           model.toLowerCase().includes('coder') && !model.includes('grok');
    const supportsVision = !isTextOnlyModel;
    
    // Removed stripUnexecutedCodeBlocks - no longer needed since we use LangChain messages directly with full content

    // Build messages array, preserving reasoning_details from previous messages
    const messages: any[] = [];

    // Use LangChain messages directly - no formatting as text
    // LangChain memory provides properly formatted messages that should be added directly
    if (conversationHistory && conversationHistory.length > 0) {
      // Add conversation history messages directly with their proper roles
      // LangChain already handled optimization and includes execution results in content
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role,
          content: msg.content || ''
        });
      }
    }

    // Current request as the final user message
    // No need for "Recent Context" header - execution results are already in conversation history messages
    let userMessageContent: any;
    if (images && images.length > 0 && supportsVision) {
      userMessageContent = [{ type: 'text', text: prompt }];
      for (const imageUrl of images) {
        if (imageUrl.startsWith('data:')) {
          userMessageContent.push({ type: 'image_url', image_url: { url: imageUrl } });
        }
      }
    } else {
      userMessageContent = prompt;
    }

    messages.push({ role: 'user', content: userMessageContent });

    // Determine max_tokens based on model capabilities
    // Different models have different total context limits
    // We set max_tokens to leave room for input (typically 60-70% of total for output)
    let maxTokens = 1500000; // Default high limit for main models
    
    // Model-specific context limits (total context window) - loaded dynamically
    const { getModelContextLimitsMap: getModelContextLimitsMapB } = await import('./openRouterModels');
    const modelContextLimits = getModelContextLimitsMapB();
    
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
    
    // DYNAMIC MAX_TOKENS: Cap based on actual input size to prevent context overflow
    // Estimate input tokens (rough: 1 token ≈ 4 chars for English text)
    const inputEstimate = messages.reduce((sum, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return sum + Math.ceil(content.length / 4);
    }, 0);
    
    // Get model's total context limit from user settings
    // Each model has its own context limit configured in settings
    let totalContextLimit = modelContextLimits[model];
    if (!totalContextLimit || totalContextLimit <= 0) {
      // Model not found in settings or has invalid limit - use conservative default
      // User should configure this in settings for accurate token management
      totalContextLimit = 128000; // Conservative default (128k) - user should set this in settings
    }
    const remainingContext = totalContextLimit - inputEstimate;
    
    // CRITICAL FIX: Always cap output tokens to 85% of remaining context to prevent overflow
    // This ensures input + output never exceeds the model's context limit
    if (remainingContext > 0) {
      const maxAllowedOutput = Math.floor(remainingContext * 0.85);
      if (maxTokens > maxAllowedOutput) {
        maxTokens = maxAllowedOutput;
      }
    } else if (remainingContext <= 0) {
      // Input already exceeds or equals context limit - set very low output limit
      maxTokens = 2000;
    }
    
    // Ensure at least some output is possible (minimum 2000 tokens)
    maxTokens = Math.max(maxTokens, 2000);

    // Cap max_tokens to reasonable limit (most responses don't need 100k+ tokens)
    // Increased to 16000 to allow for complex error handling, code generation, and clarifying questions
    maxTokens = Math.min(maxTokens, 16000);
    
    // Log token information
    console.log(`📊 Tokens: Input ~${inputEstimate.toLocaleString()}, Context ${totalContextLimit.toLocaleString()}, Remaining ${remainingContext.toLocaleString()}, Max Output ${maxTokens.toLocaleString()}`);
    
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

    // Create timeout signal that also respects user abort
    const timeoutSignal = createTimeoutSignal(API_TIMEOUT_MS, options.signal);
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin, // Optional: for analytics
        'X-Title': 'Volleyball Analytics AI' // Optional: for analytics
      },
      body: JSON.stringify(requestBody),
      signal: timeoutSignal
    });

    if (!response.ok) {
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorData = await response.json();
        console.error('❌ API error response:', errorData);
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
          console.error('❌ API error text:', text.substring(0, 200));
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

    // Keep event loop active even when tab is hidden
    let keepAlive: NodeJS.Timeout | null = setInterval(() => {
      // Empty callback - just keeps the event loop active
    }, 100);

    // Track if we've received any data to detect stalled streams
    let hasReceivedData = false;
    let lastDataTime = Date.now();
    const STREAM_TIMEOUT_MS = 30000; // 30 second timeout for each chunk

    try {
      while (true) {
        // Add timeout for each read operation to prevent infinite hangs
        const readPromise = reader.read();
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Stream read timeout - no data received for ${STREAM_TIMEOUT_MS / 1000}s. The API may be overloaded or the model may be unavailable.`));
          }, STREAM_TIMEOUT_MS);
        });

        const { done, value } = await Promise.race([readPromise, timeoutPromise]);
        clearTimeout(timeoutId!); // Clear timeout once we get data

        if (done) {
          // Check if we received any data at all
          if (!hasReceivedData) {
            throw new Error('Stream ended without receiving any data from API. The model may be overloaded or unavailable.');
          }
          break;
        }

        hasReceivedData = true;
        lastDataTime = Date.now();

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
                batchedOnDelta(content);
              }

              // Check for finish_reason to detect truncation
              const finishReason = json.choices?.[0]?.finish_reason;
              if (finishReason === 'length') {
                console.error('⚠️ Response was truncated due to token limit! finish_reason: length');
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

      // Flush any remaining buffered deltas
      if (deltaTimeout) {
        clearTimeout(deltaTimeout);
      }
      flushDeltaBuffer();

      onDone();
    } finally {
      // Always clear keep-alive interval
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
    }
  } catch (error) {
    
    // Flush buffer on error too
    if (deltaTimeout) {
      clearTimeout(deltaTimeout);
    }
    flushDeltaBuffer();

    // Check if error is due to abort
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
      onError('Request was aborted by user');
      return;
    }

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
      }),
      signal: createTimeoutSignal()
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
      }),
      signal: createTimeoutSignal()
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
  const { prompt, model, conversationHistory, onDelta, onDone, onError, signal } = options;
  const provider = getProviderForModel(model);
  if (!provider) throw new Error('No provider found for model');
  
  const apiKey = getApiKey(provider.id);
  if (!apiKey) throw new Error('No API key found');

  try {
    // Build messages array from conversation history
    const messages: Array<{ role: string; content: string }> = [];
    
    // Add conversation history if provided
    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        // Only include role and content, strip executionResults to avoid tool use errors
        messages.push({
          role: msg.role,
          content: msg.content || ''
        });
      }
    }
    
    // Add current prompt as final user message
    messages.push({ role: 'user', content: prompt });
    
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
        messages: messages,
        stream: true // Enable streaming
      }),
      signal: signal ? createTimeoutSignal(API_TIMEOUT_MS, signal) : createTimeoutSignal()
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
      }),
      signal: createTimeoutSignal()
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

