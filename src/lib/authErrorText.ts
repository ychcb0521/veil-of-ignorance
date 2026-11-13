const EMPTY_ERROR=/^(?:\{\s*\}|\[\s*\]|\[object Object\]|undefined|null)?$/;
/** Keep diagnostics useful without exposing server SQL, payloads or credentials. */
export function authServiceFailure(status:number,code?:unknown,message?:unknown):string {
 const tag=typeof code==='string'&&/^[a-z_0-9-]{1,64}$/i.test(code)?`，${code}`:'';
 if(typeof message==='string'&&/read.only|SQLSTATE\s*25006/i.test(message))return `登录数据库暂时只读，无法保存登录会话（HTTP ${status}${tag}）。账户和交易数据会保留，请等待服务恢复。`;
 if (code === 'request_timeout') return `登录服务等待数据库响应超时（HTTP ${status}）。请稍后重试。`;
 return `登录服务暂时异常（HTTP ${status}${tag}），暂时无法完成登录。请稍后重试；账户和交易数据会保留。`;
}
export function authErrorText(error:unknown):string {
 const e=typeof error==='object'&&error!==null?error as {message?:unknown;status?:unknown;code?:unknown}:undefined;
 const message=typeof e?.message==='string'?e.message:typeof error==='string'?error:'';
 if(/^登录(?:服务暂时异常|服务等待数据库响应超时|数据库暂时只读)/.test(message))return message;
 if(typeof e?.status==='number'&&e.status>=500)return authServiceFailure(e.status,e.code,message);
 return !EMPTY_ERROR.test(message.trim())?message:'登录服务返回了无法识别的错误，暂时无法完成登录。请稍后重试；账户和交易数据会保留。';
}
