// Type surface of the browser modules when imported from server TypeScript.
declare module '*/browser/cad.js' {
  const CAD: {
    generateDesign(design: unknown, overrides?: Record<string, number>, constraints?: unknown): Promise<any>;
    evalExpr(src: unknown, vars: Record<string, number>, path: string): number;
    CadError: new (...a: any[]) => Error;
  };
  export default CAD;
}
declare module '*/browser/agents.js' {
  const Agents: {
    briefOf(idea: string, understanding: string, qa: { question: string; answer: string }[]): string;
    clarifyPrompt(idea: string, qa: { question: string; answer: string }[], round: number, maxRounds: number): string;
    designLoop(deps: { ask: (p: string, o: any) => Promise<unknown>; build: (d: unknown) => Promise<any>; render: null | ((r: any) => Promise<Blob | null>); onStep: (id: string, state: string, info?: unknown) => void }, brief: string, opts?: { maxRepairs?: number; inspect?: boolean; autoFix?: boolean }): Promise<{ design: any; result: any; error: any; inspection: any }>;
  };
  export default Agents;
}
