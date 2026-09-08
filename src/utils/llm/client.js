// utils/llm/client.js - LLM 客户端封装
// 提供统一的 LLM 调用接口，支持结构化输出和文本生成

import storage from '../storage.js';
import { scopedKey } from '../account/userScope.js';
import userManager from '../account/userManager.js';
const { STORAGE_KEYS } = storage;

// #ifndef MP-WEIXIN
/**
 * H5 环境默认 API 配置（DeepSeek）。
 * 仅保留公开的 endpoint 与默认模型名；非测试账号必须由用户在设置页配置自己的 Key。
 */
const H5_DEFAULT_CONFIG = {
  ENDPOINT: 'https://api.deepseek.com',
  API_KEY: '',
  MODEL: 'deepseek-v4-flash'
};
// #endif

/**
 * 内置测试 API（DeepSeek）。
 * 仅供测试账号（含 admin）用于测试游戏玩法，无需在设置页配置 Key。
 * ⚠️ 此 Key 会随前端打包分发，仅用于本地测试环境；上线前应移除并强制用户自配 Key。
 */
const TEST_API_CONFIG = {
  ENDPOINT: 'https://api.deepseek.com',
  API_KEY: 'sk-2476b94b25964ffe868774234eb25216',
  MODEL: 'deepseek-v4-flash'
};

/**
 * 是否为 DeepSeek V4 系模型/端点（需显式传 thinking 参数）。
 * DeepSeek V4（deepseek-v4-flash / deepseek-v4-pro）的 thinking 参数默认是 enabled（思考模式）：
 * 思考模式下最终答案之前的推理全部进入 message.reasoning_content，且默认 reasoning_effort=high，
 * 若 max_tokens 预算先被推理耗尽，message.content 会为空字符串 —— 本产品的角色卡提示词要求 AI
 * 把 [thinking] 框作为可见正文输出（content），所以对 DeepSeek 显式传 thinking:disabled，
 * 让正文直接进 content；只有非 DeepSeek 的自定义端点不受影响。
 */
function _isDeepSeekLike(endpoint, model) {
  const host = String(endpoint || '').toLowerCase();
  const mdl = String(model || '').toLowerCase();
  return host.includes('deepseek.com') || host.includes('deepseek') || mdl.startsWith('deepseek-v4') || mdl === 'deepseek-chat' || mdl === 'deepseek-reasoner';
}

/**
 * 从 OpenAI 兼容的非流式响应 message 中取正文：
 * 优先 message.content；若为空（例如 DeepSeek 思考模式下推理把预算耗尽），
 * 退而取 message.reasoning_content，避免把一次可用的响应误判为"格式异常"。
 */
function _pickAssistantText(message) {
  if (!message || typeof message !== 'object') return '';
  const content = message.content;
  if (typeof content === 'string' && content.trim()) return content;
  const reasoning = message.reasoning_content;
  if (typeof reasoning === 'string' && reasoning.trim()) return reasoning;
  return '';
}

/**
 * 默认配置常量
 * 从原 ai-helper.js 中提取的默认值，作为后备配置
 * 注意：ai-helper.js 使用的是腾讯云开发的 AI 能力，没有传统的 API endpoint
 */
const DEFAULT_CONFIG = {
  // 默认使用腾讯云开发 AI（不需要 endpoint 和 apiKey）
  ENDPOINT: '',
  API_KEY: '',
  MODEL: 'hunyuan-t1-latest',
  // 备用模型列表
  FALLBACK_MODELS: [
    'hunyuan-t1-latest',
    'hunyuan-lite', 
    'hunyuan-turbo',
    'hunyuan-turbos-latest',
    'hunyuan-standard'
  ]
};

/**
 * LLMClient 类
 * 提供结构化输出和文本生成功能，支持重试和禁止词检测
 */
class LLMClient {
  /**
   * 构造函数
   * @param {string} apiKey - API 密钥（可选）
   * @param {object} options - 配置选项
   * @param {number} options.maxRetries - 最大重试次数，默认 3
   * @param {number} options.baseDelay - 基础延迟（毫秒），默认 1000
   * @param {string[]} options.forbiddenWords - 禁止词列表，默认 []
   * @param {string} options.endpoint - API 端点，默认使用 DEFAULT_CONFIG.ENDPOINT
   */
  constructor(apiKey, options = {}) {
    // 构造函数参数仅作为后备，实际调用时优先从 storage 读取
    this.fallbackApiKey = apiKey || DEFAULT_CONFIG.API_KEY;
    this.fallbackEndpoint = options.endpoint || DEFAULT_CONFIG.ENDPOINT;
    
    // 配置选项
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.forbiddenWords = options.forbiddenWords || [];
    
    console.log('[LLMClient] 初始化完成', {
      maxRetries: this.maxRetries,
      baseDelay: this.baseDelay,
      forbiddenWordsCount: this.forbiddenWords.length
    });
  }

  /**
   * 生成结构化输出
   * 强制 LLM 返回符合指定 schema 的 JSON 对象
   * 
   * @param {string} prompt - 提示词
   * @param {object} schema - JSON schema 对象，例如 { name: 'string', age: 'number' }
   * @returns {Promise<object>} 解析后的 JavaScript 对象
   * @throws {Error} 网络错误、解析错误、字段缺失、禁止词命中时抛出
   */
  async generateStructured(prompt, schema) {
    console.log('[LLMClient] 生成结构化输出', { 
      promptLength: prompt.length, 
      schema 
    });

    // 构造强制 JSON 输出的提示词
    const schemaDescription = this._formatSchemaForPrompt(schema);
    const enhancedPrompt = `${prompt}\n\n请严格按照以下 JSON 格式返回结果，不要添加任何额外的文字说明：\n${schemaDescription}\n\n只返回 JSON 对象，不要使用 Markdown 代码块。`;

    // 使用指数退避重试
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[LLMClient] 结构化生成尝试 ${attempt}/${this.maxRetries}`);
        
        // 调用底层 API
        const responseText = await this._callAPI([
          { role: 'user', content: enhancedPrompt }
        ]);

        // 解析 JSON
        const parsedObject = this._parseJSON(responseText);

        // 验证字段完整性
        this._validateSchema(parsedObject, schema);

        // 禁止词检测
        this._checkForbiddenWords(responseText);

        console.log('[LLMClient] 结构化生成成功', parsedObject);
        return parsedObject;

      } catch (error) {
        lastError = error;
        console.warn(`[LLMClient] 第 ${attempt} 次尝试失败:`, error.message);

        // 如果不是最后一次，执行指数退避
        if (attempt < this.maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt - 1);
          console.log(`[LLMClient] 等待 ${delay}ms 后重试...`);
          await this._sleep(delay);
        }
      }
    }

    // 所有重试都失败
    console.error('[LLMClient] 结构化生成失败，重试耗尽');
    throw new Error(`结构化生成失败（已重试 ${this.maxRetries} 次）: ${lastError.message}`);
  }

  /**
   * 生成普通文本
   * 不强制 JSON 格式，仅做禁止词检测
   * 
   * @param {string} prompt - 提示词
   * @returns {Promise<string>} 生成的文本内容
   * @throws {Error} 网络错误、禁止词命中时抛出
   */
  async generateText(prompt) {
    console.log('[LLMClient] 生成文本', { promptLength: prompt.length });

    // 使用指数退避重试
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[LLMClient] 文本生成尝试 ${attempt}/${this.maxRetries}`);

        // 调用底层 API
        const responseText = await this._callAPI([
          { role: 'user', content: prompt }
        ]);

        // 禁止词检测
        this._checkForbiddenWords(responseText);

        console.log('[LLMClient] 文本生成成功', { 
          length: responseText.length 
        });
        return responseText;

      } catch (error) {
        lastError = error;
        console.warn(`[LLMClient] 第 ${attempt} 次尝试失败:`, error.message);

        // 如果不是最后一次，执行指数退避
        if (attempt < this.maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt - 1);
          console.log(`[LLMClient] 等待 ${delay}ms 后重试...`);
          await this._sleep(delay);
        }
      }
    }

    // 所有重试都失败
    console.error('[LLMClient] 文本生成失败，重试耗尽');
    throw new Error(`文本生成失败（已重试 ${this.maxRetries} 次）: ${lastError.message}`);
  }

  /**
   * 用完整 messages 数组调用 LLM（支持多轮对话历史）
   *
   * 这是逐条消息传递模式的核心方法。
   * messages 格式：[{ role: 'system'|'user'|'assistant', content: string }, ...]
   *
   * 与 generateText 的区别：
   *   - generateText 把所有内容打包成一条 user 消息
   *   - generateWithMessages 保持对话轮次结构，让 AI 能理解"谁说了什么"
   *     从而支持 Author's Note 深度注入（在历史记录中间插入 system 消息）
   *
   * @param {Array<{role: string, content: string}>} messages - 完整消息数组
   * @param {object} [genParams] - 生成参数覆盖（temperature/maxTokens/topP/presencePenalty/frequencyPenalty），
   *                                通常来自 Preset.generationParams，未提供的字段使用各端默认值
   * @returns {Promise<string>} AI 的回复文本
   */
  async generateWithMessages(messages, genParams) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('[LLMClient] generateWithMessages: messages 不能为空');
    }

    console.log('[LLMClient] generateWithMessages', {
      messageCount: messages.length,
      roles: messages.map(function(m) { return m.role; }).join(','),
      genParams: genParams || '(默认)'
    });

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[LLMClient] generateWithMessages 尝试 ${attempt}/${this.maxRetries}`);

        const responseText = await this._callAPI(messages, genParams);
        this._checkForbiddenWords(responseText);

        console.log('[LLMClient] generateWithMessages 成功', { length: responseText.length });
        return responseText;

      } catch (error) {
        lastError = error;
        console.warn(`[LLMClient] generateWithMessages 第 ${attempt} 次失败:`, error.message);

        if (attempt < this.maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt - 1);
          await this._sleep(delay);
        }
      }
    }

    throw new Error(`generateWithMessages 失败（已重试 ${this.maxRetries} 次）: ${lastError.message}`);
  }

  /**
   * 用完整 messages 数组流式调用 LLM（SSE）。
   * H5 端走 fetch + ReadableStream 解析 SSE；小程序端 uni.request 无流式能力，退回一次性返回。
   * @param {Array} messages - 消息数组
   * @param {object} [genParams] - 生成参数（stream 会被强制置 true）
   * @param {(partialText: string) => void} [onChunk] - 每收到一个增量即回调累积全文
   * @returns {Promise<string>} 最终完整回复
   */
  async generateWithMessagesStream(messages, genParams, onChunk) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('[LLMClient] generateWithMessagesStream: messages 不能为空');
    }
    const userConfig = storage.get(scopedKey('ai_model_settings')) || storage.get(STORAGE_KEYS.LLM_CONFIG) || {};
    const isTestAccount = userManager.isTestAccount();
    const wantsTestModel = userConfig.model === 'test';
    if (wantsTestModel && !isTestAccount) {
      throw new Error('内置测试 API 仅测试账号可用，请在设置中选择其他模型');
    }

    // 显式选择"测试模型"：直接用内置测试 API（H5 走 SSE，其余平台退回一次性）
    if (wantsTestModel) {
      // #ifdef MP-WEIXIN
      const full = await this._callCustomAPI(TEST_API_CONFIG.ENDPOINT, TEST_API_CONFIG.API_KEY, TEST_API_CONFIG.MODEL, messages, genParams);
      if (onChunk) onChunk(full);
      return full;
      // #endif
      // #ifndef MP-WEIXIN
      return await this._streamWithFetch(TEST_API_CONFIG.ENDPOINT, TEST_API_CONFIG.API_KEY, TEST_API_CONFIG.MODEL, messages, genParams, onChunk);
      // #endif
    }

    let apiKey = userConfig.apiKey || this.fallbackApiKey;
    let endpoint = userConfig.apiUrl || this.fallbackEndpoint;
    let modelName = userConfig.modelName || (userConfig.model && userConfig.model !== 'default' ? userConfig.model : null);

    // #ifdef MP-WEIXIN
    if (!modelName) modelName = DEFAULT_CONFIG.MODEL;
    let full;
    if (endpoint && apiKey) {
      full = await this._callCustomAPI(endpoint, apiKey, modelName, messages, genParams);
    } else {
      full = await this._callCloudAI(modelName, messages);
    }
    if (onChunk) onChunk(full);
    return full;
    // #endif

    // #ifndef MP-WEIXIN
    if (!endpoint) endpoint = H5_DEFAULT_CONFIG.ENDPOINT;
    if (!modelName) modelName = H5_DEFAULT_CONFIG.MODEL;
    if (!apiKey) {
      // 测试账号兜底：未配置 Key 时使用内置测试 API
      if (isTestAccount) {
        apiKey = TEST_API_CONFIG.API_KEY;
        endpoint = TEST_API_CONFIG.ENDPOINT;
        modelName = TEST_API_CONFIG.MODEL;
      } else {
        throw new Error('未配置 API Key，请在「设置」页填写 API Key 后再对话');
      }
    }
    return await this._streamWithFetch(endpoint, apiKey, modelName, messages, genParams, onChunk);
    // #endif
  }

  /**
   * 中断当前流式请求（SSE）
   */
  abortStream() {
    if (this._abortController) {
      try { this._abortController.abort(); } catch (e) { /* ignore */ }
      this._abortController = null;
    }
  }

  /**
   * H5 端：fetch + ReadableStream 解析 OpenAI 兼容 SSE 流
   * @private
   */
  // #ifndef MP-WEIXIN
  async _streamWithFetch(endpoint, apiKey, model, messages, genParams, onChunk) {
    // H5 环境：将所有请求改为相对路径 /api，由后端代理转发
    let url = '/api/chat/completions';

    const params = genParams || {};
    const requestBody = {
      model: model,
      messages: messages,
      temperature: typeof params.temperature === 'number' ? params.temperature : 0.7,
      max_tokens: typeof params.maxTokens === 'number' ? params.maxTokens : 2000,
      stream: true
    };
    if (typeof params.topP === 'number') requestBody.top_p = params.topP;
    if (typeof params.presencePenalty === 'number') requestBody.presence_penalty = params.presencePenalty;
    if (typeof params.frequencyPenalty === 'number') requestBody.frequency_penalty = params.frequencyPenalty;
    if (typeof params.topK === 'number' && params.topK > 0) requestBody.top_k = params.topK;
    if (typeof params.seed === 'number' && params.seed >= 0) requestBody.seed = params.seed;
    if (typeof params.n === 'number' && params.n > 1) requestBody.n = params.n;
    // DeepSeek V4：thinking 默认 enabled（思考模式会吞掉正文，content 可能为空），
    // 显式关闭思考模式，让回复正文直接进 content（详见 _isDeepSeekLike 注释）。
    if (_isDeepSeekLike(endpoint, model)) {
      requestBody.thinking = { type: 'disabled' };
    }

    const controller = new AbortController();
    this._abortController = controller;

    // H5 环境：将 API 配置通过请求头传递给后端代理
    const headers = {
      'Content-Type': 'application/json'
    };
    if (endpoint) headers['X-API-Base'] = endpoint;
    if (apiKey) headers['X-API-Key'] = apiKey;

    console.log('[API Request] URL:', url);
    console.log('[API Request] Headers:', headers);
    console.log('[API Request] Body size:', JSON.stringify(requestBody).length);
    console.log('[API Request] UA:', typeof navigator !== 'undefined' ? navigator.userAgent : '(无 navigator)');

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (error) {
      // fetch() 本身抛出异常：说明请求根本没有拿到 HTTP 响应（网络中断/域名解析失败/
      // 证书问题/被浏览器安全策略拦截等），而不是服务端返回了错误状态码。
      this._abortController = null;
      console.error('[API Error] fetch() 抛出异常（未收到任何 HTTP 响应）');
      console.error('[API Error] Name:', error.name);
      console.error('[API Error] Message:', error.message);
      console.error('[API Error] Stack:', error.stack);
      throw error;
    }

    console.log('[API Response] Status:', resp.status);
    console.log('[API Response] StatusText:', resp.statusText);
    try {
      console.log('[API Response] Headers:', Object.fromEntries(resp.headers.entries()));
    } catch (e) {
      console.log('[API Response] Headers: (当前环境的 Headers 不支持 entries()，跳过打印)');
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('[API Response] 非 200 响应，Body preview:', errText.slice(0, 500));
      this._abortController = null;
      throw new Error(`HTTP ${resp.status}: ${errText || '请求失败'}`);
    }

    const supportsStreamReader = !!(resp.body && typeof resp.body.getReader === 'function');
    console.log('[API Response] 当前环境是否支持 ReadableStream.getReader:', supportsStreamReader);

    if (!supportsStreamReader) {
      // ⚠️ 部分手机浏览器内核（某些内置 WebView / 第三方 App 内嵌浏览器）的 fetch()
      // 不支持流式 body（resp.body.getReader 不存在）。但此时响应体仍然是完整的
      // text/event-stream 文本（因为请求里 stream:true，服务端/DeepSeek 真实返回的就是 SSE），
      // 绝不是 JSON！旧代码在这里直接 `await resp.json()` 会因为 SSE 文本不是合法 JSON
      // 而抛出 SyntaxError，冒泡到 onError 后前端显示"抱歉，发生了错误，请重试。"——
      // 这正是"后端日志 200 成功、前端却报错"最常见的原因，这里改为按 SSE 格式手动解析全文。
      const rawText = await resp.text();
      console.log('[API Response] Body preview (无流式能力，一次性读取):', rawText.slice(0, 500));
      this._abortController = null;
      const sseText = this._parseSSEText(rawText, onChunk);
      if (sseText) return sseText;
      // 极少数代理/网关会直接把 stream 请求降级为一次性标准 JSON 响应，这里再兜底解析一次
      try {
        const data = JSON.parse(rawText);
        const content = _pickAssistantText(data?.choices?.[0]?.message);
        if (onChunk) onChunk(content);
        return content;
      } catch (e) {
        console.error('[API Error] 响应既无法按 SSE 解析出内容，也不是合法 JSON');
        console.error('[API Error] JSON.parse 失败原因:', e.message);
        throw new Error('响应格式无法解析（既非可用的 SSE，也非合法 JSON），详见控制台 Body preview 日志');
      }
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let chunkCount = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[API Response] 流读取结束(done=true)，累计 chunk 数:', chunkCount, '累计字符数:', fullText.length);
          break;
        }
        chunkCount++;
        const decoded = decoder.decode(value, { stream: true });
        if (chunkCount <= 2) {
          console.log(`[API Response] 第 ${chunkCount} 个 chunk 原始预览:`, decoded.slice(0, 500));
        }
        buffer += decoded;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            this._abortController = null;
            return fullText;
          }
          try {
            const json = JSON.parse(data);
            // 兼容思考模式：正文增量在 delta.content，若模型返回了 reasoning_content
            // 增量（理论上已通过 thinking:disabled 关闭，仅作兜底），也累加进去
            const delta = json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.delta?.reasoning_content;
            if (delta) {
              fullText += delta;
              if (onChunk) onChunk(fullText);
            }
          } catch (e) { /* 忽略无法解析的分帧 */ }
        }
      }
    } catch (error) {
      // reader.read() 抛出异常：常见于手机浏览器内核对 ReadableStream 支持不完整
      // （号称支持 getReader，但读到一半时抛错），或连接被中途重置。
      console.error('[API Error] 读取流式响应时抛出异常（reader.read() 失败）');
      console.error('[API Error] Name:', error.name);
      console.error('[API Error] Message:', error.message);
      console.error('[API Error] Stack:', error.stack);
      console.error('[API Error] 中断前已累计文本长度:', fullText.length);
      this._abortController = null;
      // 已经拿到部分内容时，优先把已生成内容返回，避免用户什么都看不到
      if (fullText) {
        if (onChunk) onChunk(fullText);
        return fullText;
      }
      throw error;
    }
    this._abortController = null;
    return fullText;
  }

  /**
   * 手动解析一段完整的 SSE 文本（用于 fetch 不支持 ReadableStream.getReader 的手机浏览器兜底）
   * @private
   */
  _parseSSEText(rawText, onChunk) {
    if (!rawText || rawText.indexOf('data:') === -1) return '';
    let fullText = '';
    const lines = rawText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') break;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.delta?.reasoning_content;
        if (delta) {
          fullText += delta;
          if (onChunk) onChunk(fullText);
        }
      } catch (e) { /* 忽略无法解析的分帧 */ }
    }
    return fullText;
  }
  // #endif

  /**
   * 调用底层 API
   * 配置优先级：storage 配置 > 构造函数参数 > 默认常量
   * 
   * @private
   * @param {Array} messages - 消息数组
   * @returns {Promise<string>} API 返回的文本内容
   * @throws {Error} 网络错误或 HTTP 错误时抛出
   */
  async _callAPI(messages, genParams) {
    // 1. 优先从 storage 读取用户配置（按当前登录用户隔离，settings.vue 写入时用同一 scopedKey）
    const userConfig = storage.get(scopedKey('ai_model_settings')) || storage.get(STORAGE_KEYS.LLM_CONFIG) || {};
    const isTestAccount = userManager.isTestAccount();

    // 安全兜底：测试模型仅测试账号（含 admin）可用，非测试账号即使本地配置被篡改为 test 也会被拒绝
    const wantsTestModel = userConfig.model === 'test';
    if (wantsTestModel && !isTestAccount) {
      throw new Error('内置测试 API 仅测试账号可用，请在设置中选择其他模型');
    }

    // 显式选择"测试模型"：直接用内置测试 API（无需配置 Key）
    if (wantsTestModel) {
      return await this._callCustomAPI(TEST_API_CONFIG.ENDPOINT, TEST_API_CONFIG.API_KEY, TEST_API_CONFIG.MODEL, messages, genParams);
    }

    // 2. 确定最终使用的配置
    let apiKey = userConfig.apiKey || this.fallbackApiKey;
    let endpoint = userConfig.apiUrl || this.fallbackEndpoint;
    let modelName = userConfig.modelName || (userConfig.model && userConfig.model !== 'default' ? userConfig.model : null);

    // #ifdef MP-WEIXIN
    // 小程序端：无用户配置时走腾讯云开发 AI
    if (!modelName) modelName = DEFAULT_CONFIG.MODEL;
    console.log('[LLMClient] API 配置（小程序）', {
      hasUserConfig: !!userConfig.apiKey,
      endpoint: endpoint || '(使用云开发)',
      model: modelName
    });
    if (endpoint && apiKey) {
      return await this._callCustomAPI(endpoint, apiKey, modelName, messages, genParams);
    } else {
      return await this._callCloudAI(modelName, messages);
    }
    // #endif

    // #ifndef MP-WEIXIN
    // H5 端：无用户配置时使用 H5_DEFAULT_CONFIG（DeepSeek）
    if (!endpoint) endpoint = H5_DEFAULT_CONFIG.ENDPOINT;
    if (!modelName) modelName = H5_DEFAULT_CONFIG.MODEL;
    if (!apiKey) {
      // 测试账号兜底：未配置 Key 时使用内置测试 API，便于直接测试玩法
      if (isTestAccount) {
        apiKey = TEST_API_CONFIG.API_KEY;
        endpoint = TEST_API_CONFIG.ENDPOINT;
        modelName = TEST_API_CONFIG.MODEL;
      } else {
        throw new Error('未配置 API Key，请在「设置」页填写 API Key 后再对话');
      }
    }
    console.log('[LLMClient] API 配置（H5）', {
      hasUserConfig: !!userConfig.apiKey,
      isTestAccount,
      endpoint,
      model: modelName
    });
    return await this._callCustomAPI(endpoint, apiKey, modelName, messages, genParams);
    // #endif
  }

  /**
   * 调用自定义 API（OpenAI 兼容接口）
   * @private
   * @param {object} [genParams] - { temperature, maxTokens, topP, presencePenalty, frequencyPenalty }
   *                                来自 Preset.generationParams，未提供字段使用默认值
   */
  async _callCustomAPI(endpoint, apiKey, model, messages, genParams) {
    // #ifdef H5
    // H5 环境：将所有请求改为相对路径 /api，由后端代理转发
    const url = '/api/chat/completions';
    // #endif
    
    // #ifndef H5
    // 非 H5 环境（小程序等）：保持原有逻辑，直接调用真实 API
    let url = endpoint;
    if (url && !url.endsWith('/completions') && !url.endsWith('/chat/completions')) {
      url = url.replace(/\/$/, '') + '/chat/completions';
    }
    // #endif

    const params = genParams || {};
    const requestBody = {
      model: model,
      messages: messages,
      temperature: typeof params.temperature === 'number' ? params.temperature : 0.7,
      max_tokens: typeof params.maxTokens === 'number' ? params.maxTokens : 2000
    };
    if (typeof params.topP === 'number') requestBody.top_p = params.topP;
    if (typeof params.presencePenalty === 'number') requestBody.presence_penalty = params.presencePenalty;
    if (typeof params.frequencyPenalty === 'number') requestBody.frequency_penalty = params.frequencyPenalty;
    // 以下几项酒馆预设字段（Sprint：预设编辑页补齐字段后新增），OpenAI 兼容接口按需支持，
    // 不是所有第三方端点都认识 top_k/seed/n，但带上去不会破坏标准 OpenAI 请求格式
    if (typeof params.topK === 'number' && params.topK > 0) requestBody.top_k = params.topK;
    if (typeof params.seed === 'number' && params.seed >= 0) requestBody.seed = params.seed;
    if (typeof params.n === 'number' && params.n > 1) requestBody.n = params.n;
    // DeepSeek V4：thinking 默认 enabled（思考模式让 content 为空、文本全在 reasoning_content），
    // 显式关闭思考模式，正文直接进 content（详见 _isDeepSeekLike 注释）。
    if (_isDeepSeekLike(endpoint, model)) {
      requestBody.thinking = { type: 'disabled' };
    }
    // 注意：预设里的 stream 开关目前不会转发给真实请求。当前 uni.request 调用方式期望一次性
    // 返回完整 JSON（res.data.choices[0].message.content），不具备解析 SSE 分块响应的能力；
    // 如果把 stream:true 传给服务端，返回的会是 text/event-stream 分块文本，会直接解析失败。
    // 前端展示的"打字机效果"由 MessageProcessor._simulateStream 在拿到完整回复后模拟完成，
    // 与这里的 stream 参数无关。等实现真正的 SSE 解析后再打开这个开关。

    console.log('[LLMClient] 调用自定义 API', { url, model, temperature: requestBody.temperature, max_tokens: requestBody.max_tokens });

    // #ifdef H5
    // H5 环境：将 API 配置通过请求头传递给后端代理
    const headers = {
      'Content-Type': 'application/json'
    };
    // 将用户配置的 endpoint 和 apiKey 通过自定义请求头传递
    if (endpoint) headers['X-API-Base'] = endpoint;
    if (apiKey) headers['X-API-Key'] = apiKey;
    // #endif
    
    // #ifndef H5
    // 非 H5 环境：保持原有逻辑，直接传递 Authorization 头
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    // #endif

    console.log('[API Request] URL:', url);
    console.log('[API Request] Headers:', headers);
    console.log('[API Request] Body size:', JSON.stringify(requestBody).length);

    return new Promise((resolve, reject) => {
      uni.request({
        url: url,
        method: 'POST',
        header: headers,
        data: requestBody,
        success: (res) => {
          console.log('[API Response] Status:', res.statusCode);
          console.log('[API Response] Headers:', res.header);

          // uni.request 在 H5 端通常会按 Content-Type 自动把 JSON 响应解析成对象，
          // 但如果代理/网关返回的 Content-Type 不是 application/json（例如意外落到了
          // text/event-stream、text/plain，或者是一段 HTML 错误页），res.data 会是原始
          // 字符串。旧代码这里直接 `res.data?.choices?.[0]?.message?.content` 在字符串上
          // 取属性永远是 undefined，于是统一抛"API 返回格式异常"，把真实原因盖住了。
          let data = res.data;
          const isRawString = typeof data === 'string';
          const preview = isRawString ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500);
          console.log('[API Response] Body preview:', preview);

          if (isRawString) {
            try {
              data = JSON.parse(data);
            } catch (e) {
              console.error('[API Error] res.data 是字符串且无法 JSON.parse，可能是 SSE/HTML/纯文本响应');
              console.error('[API Error] JSON.parse 失败原因:', e.message);
            }
          }

          if (res.statusCode === 200) {
            const message = data?.choices?.[0]?.message;
            const content = _pickAssistantText(message);
            if (content) {
              resolve(content);
            } else {
              const finishReason = data?.choices?.[0]?.finish_reason;
              console.error('[API Error] HTTP 200 但正文为空（content 与 reasoning_content 均无内容）');
              console.error('[API Error] finish_reason:', finishReason);
              console.error('[API Error] 完整响应见上方 Body preview');
              reject(new Error('API 返回格式异常（HTTP 200 但正文为空' + (finishReason ? `，finish_reason=${finishReason}` : '') + '，详见控制台 Body preview 日志）'));
            }
          } else {
            const errMsg = (typeof data === 'object' ? data?.error?.message : null) || preview || '请求失败';
            reject(new Error(`HTTP ${res.statusCode}: ${errMsg}`));
          }
        },
        fail: (error) => {
          // fail 回调触发意味着请求根本没拿到 HTTP 响应（DNS 失败、TLS 握手失败、
          // 手机端网络切换/断网、被系统安全策略拦截等），而不是服务端返回了错误状态码。
          console.error('[API Error] uni.request fail（未收到任何 HTTP 响应）');
          console.error('[API Error] errMsg:', error.errMsg);
          console.error('[API Error] 完整 error 对象:', JSON.stringify(error));
          reject(new Error(`网络请求失败: ${error.errMsg}`));
        }
      });
    });
  }

  /**
   * 调用腾讯云开发 AI（默认方式）
   * @private
   */
  async _callCloudAI(model, messages) {
    console.log('[LLMClient] 调用云开发 AI', { model });

    // 检查云开发 AI 功能是否可用
    if (!uni.cloud || !uni.cloud.extend || !uni.cloud.extend.AI) {
      throw new Error('云开发 AI 功能不可用，请检查配置');
    }

    // 创建模型实例
    const aiModel = uni.cloud.extend.AI.createModel('hunyuan-exp');

    // 尝试多个模型（使用原 ai-helper.js 的成功经验）
    const modelsToTry = [model, ...DEFAULT_CONFIG.FALLBACK_MODELS].filter((m, i, arr) => 
      arr.indexOf(m) === i // 去重
    );

    let lastError;
    for (const tryModel of modelsToTry) {
      try {
        console.log(`[LLMClient] 尝试模型: ${tryModel}`);
        
        const res = await aiModel.generateText({
          model: tryModel,
          messages: messages
        });

        const content = res?.choices?.[0]?.message?.content;
        if (content) {
          console.log(`[LLMClient] 模型 ${tryModel} 调用成功`);
          return content;
        }
      } catch (error) {
        lastError = error;
        console.warn(`[LLMClient] 模型 ${tryModel} 失败:`, error.message);
      }
    }

    // 所有模型都失败
    throw new Error(`所有模型都失败: ${lastError?.message || '未知错误'}`);
  }

  /**
   * 将 schema 格式化为提示词
   * @private
   */
  _formatSchemaForPrompt(schema) {
    const fields = Object.keys(schema).map(key => {
      return `  "${key}": ${schema[key]}`;
    });
    return `{\n${fields.join(',\n')}\n}`;
  }

  /**
   * 解析 JSON 字符串
   * @private
   */
  _parseJSON(text) {
    try {
      // 尝试直接解析
      return JSON.parse(text);
    } catch (e) {
      // 尝试提取 JSON（去除 Markdown 代码块）
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || 
                        text.match(/```\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      
      // 尝试查找第一个 { 到最后一个 }
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        return JSON.parse(text.substring(startIdx, endIdx + 1));
      }

      throw new Error('无法解析 JSON: ' + e.message);
    }
  }

  /**
   * 验证 JSON 对象是否包含 schema 中的所有字段
   * @private
   */
  _validateSchema(obj, schema) {
    const missingFields = [];
    for (const field of Object.keys(schema)) {
      if (!(field in obj)) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      throw new Error(`缺少必需字段: ${missingFields.join(', ')}`);
    }
  }

  /**
   * 检查禁止词
   * @private
   */
  _checkForbiddenWords(text) {
    for (const word of this.forbiddenWords) {
      if (text.includes(word)) {
        throw new Error(`输出包含禁止词: ${word}`);
      }
    }
  }

  /**
   * 延迟工具函数
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default LLMClient;
