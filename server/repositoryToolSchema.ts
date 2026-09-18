import { z } from 'zod';

// 关联探查使用稳定的工具定义，直接解释和综合输出不发送工具声明。
export const repositoryToolSpecs: { name: string; description: string; parameters: z.ZodObject<any> }[] = [
  { name: 'read_file', description: '读取当前代码库中指定文件的源代码内容。在分析 Diff 中涉及的外部类、接口或调用逻辑时使用。', parameters: z.object({
    file_path: z.string().describe('相对于仓库根目录的文件路径 (例如: "src/Actors/Actor.cs")'),
    start_line: z.number().optional().describe('起始行号 (可选，从 1 开始)'),
    end_line: z.number().optional().describe('结束行号 (可选)'),
  }) },
  { name: 'search_code', description: '在整个代码库中利用 Git 索引全局检索符号引用、下游调用方或类/函数定义（支持正则表达式）。', parameters: z.object({
    query: z.string().describe('搜索词或正则 (例如: "DerivedAttributeSet" 或 "class\\s+Player")'),
    file_extension: z.string().optional().describe('限制文件扩展名过滤 (可选，例如: "*.cs" 或 "*.ts")'),
    offset: z.number().optional().describe('结果翻页偏移量；工具提示有下一页时使用'),
    max_results: z.number().optional().describe('本次需要的结果数；不填则使用设置页默认值'),
  }) },
  { name: 'find_files', description: '根据文件名模式通过 Git 索引快速定位文件路径，用于定位同名测试、接口契约或配置文件。', parameters: z.object({
    pattern: z.string().describe('匹配模式 (例如: "*AttributeSet*" 或 "*Test*.cs")'),
    offset: z.number().optional().describe('结果翻页偏移量；工具提示有下一页时使用'),
    max_results: z.number().optional().describe('本次需要的结果数；不填则使用设置页默认值'),
  }) },
  { name: 'repo_overview', description: '获取仓库骨架：文件总数、顶层目录统计、主语言、README/工程清单摘录、疑似入口文件。学习一座陌生仓库时必须先调用。', parameters: z.object({ note: z.string().optional().describe('可选备注，通常留空') }) },
  { name: 'repo_graph', description: '获取本地解析的类级代码图谱摘要：节点（类/React 组件/职责模块，普通函数归入所属节点）、边（calls/imports/references/inherits）、社区、活动枢纽和跨社区桥。学习仓库或追问调用关系时使用。', parameters: z.object({ note: z.string().optional().describe('可选备注，通常留空') }) },
];

export const repositoryWireTools = repositoryToolSpecs.map((spec) => ({
  type: 'function',
  function: { name: spec.name, description: spec.description, strict: false,
    parameters: z.toJSONSchema(spec.parameters, { target: 'draft-7' }) },
}));
