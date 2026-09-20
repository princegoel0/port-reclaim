declare module "pid-cwd" {
  export default function pidCwd(pid: number): Promise<string | null>;
}