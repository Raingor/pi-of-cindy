import { Outlet } from 'react-router-dom';

import { useAuth } from '@/contexts/AuthContext';

/**
 * 本 fork 没有登录线(2026-09-03 用户指令),所以这里不再是「未登录就赶去登录页」
 * 的鲁你,而只是一扇**等待态门**:真正的登录态由 main 侧 authManager.initialize()
 * 启动时无条件提交成本地会话。
 *
 * canEnterApp 为 false 只剩一种情形 —— owner 变更的 shell 重建还在飞(同一 owner 的
 * token 刷新不会把它拉低)。那是瞬态,与 isInitializing 同待遇渲染 null 等它过去;
 * 不能再 Navigate 到 /login —— 那条路由已不存在,跳过去就是一片空白。
 */
export function ProtectedRoute() {
  const { canEnterApp, isInitializing, dataOwnerId } = useAuth();

  if (isInitializing || !canEnterApp) return null;

  // Owner changes must remount the protected tree so transient New Maker
  // drafts and other route-local state cannot leak across data namespaces.
  return <Outlet key={dataOwnerId ?? 'signed-out'} />;
}
