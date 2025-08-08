/**
 * ComfyUI 工作流模板处理器 V3
 * 基于极简白名单的节点处理系统
 */

class WorkflowTemplateProcessorV3 {
    constructor(whitelist) {
        this.whitelist = this.loadWhitelist(whitelist);
        this.whitelistSet = new Set(this.whitelist);
        this.typeCache = new Map();
        this.connectionCache = new Map();
        
        // 节点处理策略
        this.NODE_STRATEGIES = {
            'SAMPLER': {
                fields: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
                replace: (node, title) => {
                    const replacements = {};
                    
                    if (node.inputs.seed !== undefined) {
                        replacements.seed = '{{SEED}}';
                    }
                    if (node.inputs.steps !== undefined) {
                        replacements.steps = '{{STEPS}}';
                    }
                    if (node.inputs.cfg !== undefined) {
                        replacements.cfg = '{{CFG}}';
                    }
                    if (node.inputs.sampler_name !== undefined) {
                        replacements.sampler_name = '{{SAMPLER}}';
                    }
                    if (node.inputs.scheduler !== undefined) {
                        replacements.scheduler = '{{SCHEDULER}}';
                    }
                    if (node.inputs.denoise !== undefined) {
                        replacements.denoise = '{{DENOISE}}';
                    }
                    
                    return replacements;
                }
            },
            
            'TEXT': {
                fields: ['text', 'positive', 'negative'],
                replace: (node, title, workflow, nodeId) => {
                    const replacements = {};
                    
                    // 处理 WeiLinPromptUI 节点的特殊情况
                    if (node.class_type === 'WeiLinPromptUI') {
                        // WeiLinPromptUI 使用 'positive' 字段
                        if (node.inputs.positive !== undefined && !this.isPlaceholder(node.inputs.positive)) {
                            // 根据标题判断是正面还是负面
                            if (this.isNegativePrompt(title)) {
                                replacements.positive = '{{NEGATIVE_PROMPT}}';
                            } else {
                                // 分析内容判断
                                const isNegative = this.analyzeTextContent(node.inputs.positive);
                                replacements.positive = isNegative ? '{{NEGATIVE_PROMPT}}' : '{{POSITIVE_PROMPT}}';
                            }
                        }
                        return replacements;
                    }
                    
                    // 处理普通文本节点
                    if (node.inputs.text !== undefined && !this.isPlaceholder(node.inputs.text)) {
                        // 步骤1: 标题判断
                        if (this.isNegativePrompt(title)) {
                            replacements.text = '{{NEGATIVE_PROMPT}}';
                        } else if (this.isPositivePrompt(title)) {
                            replacements.text = '{{POSITIVE_PROMPT}}';
                        } else {
                            // 步骤2: 连接追踪
                            const connection = this.traceConnection(nodeId, workflow);
                            if (connection) {
                                replacements.text = connection;
                            } else {
                                // 步骤3: 内容分析
                                const isNegative = this.analyzeTextContent(node.inputs.text);
                                replacements.text = isNegative ? '{{NEGATIVE_PROMPT}}' : '{{POSITIVE_PROMPT}}';
                            }
                        }
                    }
                    
                    // 处理其他可能的字段
                    if (node.inputs.positive !== undefined && !this.isPlaceholder(node.inputs.positive)) {
                        replacements.positive = '{{POSITIVE_PROMPT}}';
                    }
                    if (node.inputs.negative !== undefined && !this.isPlaceholder(node.inputs.negative)) {
                        replacements.negative = '{{NEGATIVE_PROMPT}}';
                    }
                    
                    return replacements;
                }
            },
            
            'LOADER': {
                fields: ['ckpt_name'],
                replace: (node, title) => {
                    const replacements = {};
                    
                    if (node.inputs.ckpt_name !== undefined) {
                        replacements.ckpt_name = '{{MODEL}}';
                    }
                    // 不替换 vae_name 和 clip_skip
                    // 不替换 lora_name，因为 WeiLinPromptUI 会处理 Lora
                    
                    return replacements;
                }
            },
            
            'LORA_STACK': {
                fields: ['loras', 'text'],
                replace: (node, title) => {
                    const replacements = {};
                    
                    // 检查是否是 Lora 堆节点（通过标题或类型判断）
                    const titleLower = title.toLowerCase();
                    if (titleLower.includes('lora') &&
                        (titleLower.includes('堆') || titleLower.includes('stack') ||
                         titleLower.includes('管理') || titleLower.includes('manager'))) {
                        
                        // 对于 Lora 堆节点，使用特殊的占位符
                        if (node.inputs.loras !== undefined) {
                            replacements.loras = '{{LORA_STACK_CONFIG}}';
                        }
                        if (node.inputs.text !== undefined) {
                            replacements.text = '{{LORA_STACK_TEXT}}';
                        }
                    }
                    
                    return replacements;
                }
            },
            
            'VALUE': {
                fields: ['value'],
                replace: (node, title) => {
                    if (title.match(/seed|种/i)) {
                        return { value: '{{SEED}}' };
                    }
                    if (title.match(/step|步/i)) {
                        return { value: '{{STEPS}}' };
                    }
                    if (title.match(/cfg|引导/i)) {
                        return { value: '{{CFG}}' };
                    }
                    if (title.match(/denoise|降噪/i)) {
                        return { value: '{{DENOISE}}' };
                    }
                    if (title.match(/width|宽/i)) {
                        return { value: '{{WIDTH}}' };
                    }
                    if (title.match(/height|高/i)) {
                        return { value: '{{HEIGHT}}' };
                    }
                    if (title.match(/batch|批/i)) {
                        return { value: '{{BATCH_SIZE}}' };
                    }
                    return null;
                }
            },
            
            'IMAGE_SIZE': {
                fields: ['width', 'height', 'batch_size'],
                replace: (node, title) => {
                    const replacements = {};
                    
                    if (node.inputs.width !== undefined) {
                        replacements.width = '{{WIDTH}}';
                    }
                    if (node.inputs.height !== undefined) {
                        replacements.height = '{{HEIGHT}}';
                    }
                    if (node.inputs.batch_size !== undefined) {
                        replacements.batch_size = '{{BATCH_SIZE}}';
                    }
                    
                    return replacements;
                }
            }
        };
    }

    /**
     * 加载白名单配置
     */
    loadWhitelist(content) {
        if (typeof content === 'string') {
            if (content.startsWith('{')) {
                // JSON格式
                const json = JSON.parse(content);
                return json.titles || json.keywords || [];
            } else {
                // 文本格式
                return content.split('\n')
                    .filter(line => line.trim() && !line.startsWith('#'))
                    .map(line => line.trim());
            }
        }
        return Array.isArray(content) ? content : [];
    }

    /**
     * 处理工作流
     */
    process(workflow) {
        const result = JSON.parse(JSON.stringify(workflow));
        this.connectionCache.clear();
        this.typeCache.clear();
        
        let nodesProcessed = 0;
        let fieldsReplaced = 0;
        
        // 遍历所有节点
        for (const [nodeId, node] of Object.entries(result)) {
            if (!node || typeof node !== 'object') continue;
            
            // 检查标题是否命中白名单
            const title = node._meta?.title || '';
            if (!this.matchWhitelist(title)) {
                continue;
            }
            
            nodesProcessed++;
            
            // 识别节点类型
            const nodeType = this.identifyNodeType(node);
            if (!nodeType || nodeType === 'UNKNOWN') continue;
            
            // 获取处理策略
            const strategy = this.NODE_STRATEGIES[nodeType];
            if (!strategy) continue;
            
            // 执行替换
            try {
                const replacements = strategy.replace(node, title, workflow, nodeId);
                
                // 应用替换
                if (replacements && node.inputs) {
                    for (const [field, value] of Object.entries(replacements)) {
                        if (node.inputs[field] !== undefined && !this.isPlaceholder(node.inputs[field])) {
                            node.inputs[field] = value;
                            fieldsReplaced++;
                        }
                    }
                }
            } catch (error) {
                console.error(`处理节点 ${nodeId} 时出错:`, error);
            }
        }
        
        return {
            workflow: result,
            stats: {
                nodesProcessed,
                fieldsReplaced
            }
        };
    }

    /**
     * 匹配白名单
     */
    matchWhitelist(title) {
        if (!title) return false;
        
        const titleLower = title.toLowerCase();
        for (const keyword of this.whitelistSet) {
            if (titleLower.includes(keyword.toLowerCase())) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * 识别节点类型
     */
    identifyNodeType(node) {
        const classType = node.class_type || '';
        
        // 使用缓存
        if (this.typeCache.has(classType)) {
            return this.typeCache.get(classType);
        }
        
        let nodeType = 'UNKNOWN';
        
        // 参数节点
        if (classType.includes('KSampler') || classType.includes('Sampler')) {
            nodeType = 'SAMPLER';
        }
        // 文本节点
        else if (classType.includes('CLIPTextEncode') ||
                 classType.includes('Text') ||
                 classType.includes('String') ||
                 classType.includes('WeiLinPromptUI')) {
            nodeType = 'TEXT';
        }
        // 模型加载节点
        else if (classType.includes('Loader') ||
                 classType.includes('Checkpoint') ||
                 classType.includes('Load')) {
            nodeType = 'LOADER';
        }
        // Lora 堆节点
        else if (classType.includes('Lora') &&
                 (classType.includes('Manager') || classType.includes('Stack'))) {
            nodeType = 'LORA_STACK';
        }
        // 图像尺寸节点
        else if (classType.includes('EmptyLatentImage') ||
                 classType.includes('LatentImage') ||
                 classType.includes('ImageSize')) {
            nodeType = 'IMAGE_SIZE';
        }
        // 数值节点
        else if (classType.includes('Int') ||
                 classType.includes('Float') ||
                 classType.includes('Seed') ||
                 classType.includes('Number')) {
            nodeType = 'VALUE';
        }
        
        this.typeCache.set(classType, nodeType);
        return nodeType;
    }

    /**
     * 判断是否为放大节点
     */
    isUpscaleNode(title) {
        const upscaleKeywords = ['放大', 'upscale', '细节', 'detail', '第二', 'second'];
        const titleLower = title.toLowerCase();
        
        return upscaleKeywords.some(keyword => titleLower.includes(keyword));
    }

    /**
     * 判断是否为负面提示词
     */
    isNegativePrompt(title) {
        const negativeKeywords = ['负面', '负向', 'negative', 'neg', '否定', '排除'];
        const titleLower = title.toLowerCase();
        
        return negativeKeywords.some(keyword => titleLower.includes(keyword));
    }

    /**
     * 判断是否为正面提示词
     */
    isPositivePrompt(title) {
        const positiveKeywords = ['正面', '正向', 'positive', 'pos', '肯定', '包含'];
        const titleLower = title.toLowerCase();
        
        return positiveKeywords.some(keyword => titleLower.includes(keyword));
    }

    /**
     * 追踪连接关系
     */
    traceConnection(nodeId, workflow) {
        // 检查缓存
        const cacheKey = `${nodeId}`;
        if (this.connectionCache.has(cacheKey)) {
            return this.connectionCache.get(cacheKey);
        }
        
        // 查找谁在使用这个节点的输出
        for (const [id, node] of Object.entries(workflow)) {
            if (!node || !node.inputs) continue;
            
            for (const [inputName, inputValue] of Object.entries(node.inputs)) {
                // 检查是否连接到目标节点
                if (Array.isArray(inputValue) && inputValue[0] === nodeId) {
                    // 分析输入端口名称
                    const inputLower = inputName.toLowerCase();
                    
                    if (inputLower.includes('neg') || inputLower.includes('negative')) {
                        this.connectionCache.set(cacheKey, '{{NEGATIVE_PROMPT}}');
                        return '{{NEGATIVE_PROMPT}}';
                    }
                    
                    if (inputLower.includes('pos') || inputLower.includes('positive')) {
                        this.connectionCache.set(cacheKey, '{{POSITIVE_PROMPT}}');
                        return '{{POSITIVE_PROMPT}}';
                    }
                    
                    // 检查接收节点的标题
                    if (node._meta?.title) {
                        if (this.isNegativePrompt(node._meta.title)) {
                            this.connectionCache.set(cacheKey, '{{NEGATIVE_PROMPT}}');
                            return '{{NEGATIVE_PROMPT}}';
                        }
                        if (this.isPositivePrompt(node._meta.title)) {
                            this.connectionCache.set(cacheKey, '{{POSITIVE_PROMPT}}');
                            return '{{POSITIVE_PROMPT}}';
                        }
                    }
                }
            }
        }
        
        this.connectionCache.set(cacheKey, null);
        return null;
    }

    /**
     * 分析文本内容判断正负面
     */
    analyzeTextContent(text) {
        // 负面提示词常见模式
        const negativePatterns = [
            'bad', 'worst', 'low quality', 'ugly', 'blurry',
            'deformed', 'mutation', 'nsfw', 'error', 'cropped',
            'jpeg', 'artifacts', 'watermark', 'signature',
            '低质量', '模糊', '变形', '错误', '裁剪'
        ];
        
        const textLower = text.toLowerCase();
        let negCount = 0;
        
        for (const pattern of negativePatterns) {
            if (textLower.includes(pattern)) {
                negCount++;
            }
        }
        
        // 如果包含2个或以上负面词汇，判断为负面提示词
        return negCount >= 2;
    }

    /**
     * 检查是否为占位符
     */
    isPlaceholder(value) {
        return typeof value === 'string' && 
               value.startsWith('{{') && 
               value.endsWith('}}');
    }

    /**
     * 获取处理统计信息
     */
    getStats() {
        return {
            whitelistSize: this.whitelistSet.size,
            typeCacheSize: this.typeCache.size,
            connectionCacheSize: this.connectionCache.size
        };
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkflowTemplateProcessorV3;
}