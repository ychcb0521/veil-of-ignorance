import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('app-theme') as Theme) || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * 局部固定主题：只改这棵子树里读 useTheme() 的组件（K 线图的网格、坐标轴、标注配色），
 * 不动 <html> 的 class、不写 localStorage，也不影响页面其余部分。
 * 用在屏幕外生成导出图的 K 线盘面：看板是浅色的，盘面不论应用当前是深是浅都按浅色画。
 */
export function ThemeOverride({ theme, children }: { theme: Theme; children: ReactNode }) {
  const value = useMemo<ThemeContextValue>(() => ({ theme, toggleTheme: () => {} }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
