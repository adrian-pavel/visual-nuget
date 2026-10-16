import { execFile } from 'child_process';

export function executeDotnet(args: string[], workingDirectory: string, operation: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'dotnet',
      args,
      {
        cwd: workingDirectory,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error: Error | null, stdout: string, stderr: string) => {
        if (!error) {
          resolve(stdout);
          return;
        }

        const detail = stderr.trim() || error.message;
        const sdkHint = (error as NodeJS.ErrnoException).code === 'ENOENT' ? ' Install the .NET 10 SDK or later.' : '';
        reject(new Error(`${operation} failed: ${detail}.${sdkHint}`));
      }
    );
  });
}
