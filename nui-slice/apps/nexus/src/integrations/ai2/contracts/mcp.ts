/**
 * Wave XIV — каталог MCP-серверов (docs/product/mcp-servers-contract.md,
 * draft). Источник — AI2_MCP_CONFIG или <data_dir>/mcp_servers.json.
 *
 * GET /v1/mcp/servers → {configured, servers[], error?}. Флага SDK не
 * требует; без файла конфига хост честно отвечает {servers:[],
 * configured:false} — экран показывает «нет данных», а не выдуманные
 * серверы. tools — verbatim из конфига или null (хост НЕ делает
 * tools/list при чтении каталога). envKeys — только имена переменных;
 * значения env наружу не уходят (секреты маскируются по построению).
 *
 * POST /v1/mcp/servers/{name}/call — прямого исполнения нет: первый
 * вызов создаёт заявку fs_requests (op='mcp_call',
 * status:'awaiting_confirmation'); повторный с request_id исполняет
 * вызов только когда заявка approved; pending/denied/expired → 409.
 */
export interface McpServerTool {
  name: string;
}

export interface McpServer {
  name: string;
  /** 'stdio' и др. verbatim; null — конфиг не объявил. */
  transport: string | null;
  command: string | null;
  args: string[];
  /** Verbatim из конфига; null — конфиг инструменты не объявляет. */
  tools: McpServerTool[] | null;
  /** Только имена env-переменных — значения секретов не возвращаются. */
  envKeys: string[];
  /** 'configured'|'error' verbatim — неизвестное показываем как есть. */
  status: string;
  error: string | null;
}

export interface McpCatalog {
  configured: boolean;
  servers: McpServer[];
  /** Ошибка чтения каталога verbatim; null/отсутствует — чтение чисто. */
  error: string | null;
}

/** Тело POST …/call: без requestId — создать заявку; с ним — исполнить. */
export interface McpCallInput {
  tool: string;
  arguments?: Record<string, unknown>;
  requestId?: string;
}

/** Ответ первого POST (заявка создана, исполнения нет). */
export interface McpCallAwaiting {
  status: 'awaiting_confirmation';
  requestId: string;
}

/** Ответ второго POST: исполнение после approved-заявки. */
export interface McpCallExecuted {
  status: 'executed';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string | null;
}

export type McpCallResponse = McpCallAwaiting | McpCallExecuted;
