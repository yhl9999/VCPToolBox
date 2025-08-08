#!/usr/bin/env node

const WorkflowTemplateProcessorV3 = require('./WorkflowTemplateProcessorV3');
const path = require('path');
const fs = require('fs');

// 解析命令行参数
const args = process.argv.slice(2);
const command = args[0];

if (!command) {
    showHelp();
    process.exit(1);
}

function showHelp() {
    console.log(`
ComfyUI Workflow Template CLI v3.0 - 极简白名单版

使用方法:
  node workflow-template-cli.js <command> [options]

命令:
  convert <input> <output>    将工作流转换为模板
  analyze <workflow>          分析工作流并显示将被替换的内容
  whitelist                   显示当前白名单配置
  help                        显示此帮助信息

示例:
  node workflow-template-cli.js convert workflow.json template.json
  node workflow-template-cli.js analyze workflow.json
  node workflow-template-cli.js whitelist

说明:
  - 使用极简白名单机制，只处理标题包含特定关键字的节点
  - 白名单配置在 whitelist.txt 文件中
  - 支持智能节点类型识别和差异化处理策略
`);
}

switch (command) {
    case 'convert':
        handleConvert();
        break;
    case 'analyze':
        handleAnalyze();
        break;
    case 'whitelist':
        handleWhitelist();
        break;
    case 'help':
        showHelp();
        break;
    default:
        console.error(`未知命令: ${command}`);
        showHelp();
        process.exit(1);
}

function handleConvert() {
    const inputPath = args[1];
    const outputPath = args[2];
    
    if (!inputPath || !outputPath) {
        console.error('错误: 请提供输入和输出路径');
        console.log('用法: node workflow-template-cli.js convert <input> <output>');
        process.exit(1);
    }
    
    console.log('[CLI] 正在转换工作流为模板...');
    console.log(`[CLI] 输入: ${inputPath}`);
    console.log(`[CLI] 输出: ${outputPath}`);
    
    try {
        // 加载白名单
        const whitelistPath = path.join(__dirname, 'whitelist.txt');
        const whitelistContent = fs.readFileSync(whitelistPath, 'utf8');
        const processor = new WorkflowTemplateProcessorV3(whitelistContent);
        
        // 加载工作流
        const workflowContent = fs.readFileSync(inputPath, 'utf8');
        const workflow = JSON.parse(workflowContent);
        
        // 转换为模板
        const result = processor.process(workflow);
        const template = result.workflow;
        const stats = result.stats;
        
        // 确保输出目录存在
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // 保存模板
        fs.writeFileSync(outputPath, JSON.stringify(template, null, 2), 'utf8');
        
        console.log('[CLI] ✅ 模板转换完成！');
        console.log(`[CLI] 处理的节点数: ${stats.nodesProcessed}`);
        console.log(`[CLI] 替换的字段数: ${stats.fieldsReplaced}`);
        
    } catch (error) {
        console.error('[CLI] 转换失败:', error.message);
        process.exit(1);
    }
}

function handleAnalyze() {
    const inputPath = args[1];
    
    if (!inputPath) {
        console.error('错误: 请提供输入路径');
        console.log('用法: node workflow-template-cli.js analyze <workflow>');
        process.exit(1);
    }
    
    console.log('[CLI] 正在分析工作流...');
    console.log(`[CLI] 输入: ${inputPath}`);
    
    try {
        // 加载白名单
        const whitelistPath = path.join(__dirname, 'whitelist.txt');
        const whitelistContent = fs.readFileSync(whitelistPath, 'utf8');
        const processor = new WorkflowTemplateProcessorV3(whitelistContent);
        
        // 加载工作流
        const workflowContent = fs.readFileSync(inputPath, 'utf8');
        const workflow = JSON.parse(workflowContent);
        
        // 分析工作流
        const result = processor.process(workflow);
        const stats = result.stats;
        
        console.log('\n[CLI] 分析结果:');
        console.log(`总节点数: ${Object.keys(workflow).filter(k => !k.startsWith('_')).length}`);
        console.log(`处理的节点数: ${stats.nodesProcessed}`);
        console.log(`替换的字段数: ${stats.fieldsReplaced}`);
        
        // 显示白名单匹配的节点
        console.log('\n[CLI] 匹配白名单的节点:');
        let matchedCount = 0;
        for (const [nodeId, node] of Object.entries(workflow)) {
            if (!node || typeof node !== 'object') continue;
            const title = node._meta?.title || '';
            if (processor.matchWhitelist(title)) {
                matchedCount++;
                if (matchedCount <= 10) {
                    console.log(`  节点 ${nodeId}:`);
                    console.log(`    标题: ${title}`);
                    console.log(`    类型: ${node.class_type}`);
                    console.log(`    识别为: ${processor.identifyNodeType(node)}`);
                }
            }
        }
        
        if (matchedCount > 10) {
            console.log(`  ... 还有 ${matchedCount - 10} 个节点`);
        }
    } catch (error) {
        console.error('[CLI] 分析失败:', error.message);
        process.exit(1);
    }
}

function handleWhitelist() {
    console.log('[CLI] 加载白名单配置...');
    
    const whitelistPath = path.join(__dirname, 'whitelist.txt');
    
    try {
        // 加载白名单
        const whitelistContent = fs.readFileSync(whitelistPath, 'utf8');
        const processor = new WorkflowTemplateProcessorV3(whitelistContent);
        const whitelist = processor.whitelistSet;
        
        console.log('\n[CLI] 当前白名单配置:');
        console.log('\n📋 白名单关键字:');
        
        if (whitelist.size === 0) {
            console.log('  (空白名单)');
        } else {
            Array.from(whitelist).forEach(keyword => {
                console.log(`  - "${keyword}"`);
            });
        }
        
        console.log('\n说明:');
        console.log('  - 只有节点标题包含这些关键字的节点才会被处理');
        console.log('  - 白名单配置文件: whitelist.txt');
        console.log('  - 每行一个关键字，支持注释（以 # 开头）');
        console.log('  - 空行会被忽略');
        
        // 显示节点类型识别规则
        console.log('\n🔧 节点类型识别规则:');
        console.log('  - SAMPLER: 采样器节点');
        console.log('  - TEXT: 文本/提示词节点');
        console.log('  - LOADER: 模型/检查点加载节点');
        console.log('  - VALUE: 数值参数节点');
        console.log('  - LORA_STACK: Lora堆叠节点');
        console.log('  - UNKNOWN: 未识别类型');
        
    } catch (error) {
        console.error('[CLI] 加载白名单失败:', error.message);
        process.exit(1);
    }
}