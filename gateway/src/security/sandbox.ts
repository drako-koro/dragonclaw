/**
 * AuthorClaw Sandbox Guard
 * Constrains all file operations to the workspace directory
 */

import { resolve, relative } from 'path';

export class SandboxGuard {
  private workspaceRoot: string;
  private forbiddenPatterns = [
    /\.\.\//, /\.\.\\/, // path traversal
    /\/etc\//, /\/proc\//, /\/sys\//, // system dirs
    /~\/\.ssh/, /~\/\.gnupg/, // sensitive dirs
    /\.env$/, /\.vault/, // sensitive files
    /node_modules/, // dependency dirs
  ];

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  /**
   * Validate that a path is within the workspace
   */
  validatePath(targetPath: string): { valid: boolean; reason?: string; resolved?: string } {
    const resolved = resolve(this.workspaceRoot, targetPath);
    const rel = relative(this.workspaceRoot, resolved);

    // Check it's within workspace
    if (rel.startsWith('..') || resolve(resolved) !== resolved.replace(/\/$/, '')) {
      return { valid: false, reason: 'Path escapes workspace boundary' };
    }

    // Check forbidden patterns
    for (const pattern of this.forbiddenPatterns) {
      if (pattern.test(targetPath) || pattern.test(resolved)) {
        return { valid: false, reason: `Path matches forbidden pattern: ${pattern}` };
      }
    }

    return { valid: true, resolved };
  }

  /**
   * Sanitize a filename
   */
  sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\.{2,}/g, '_')
      .substring(0, 255);
  }
}
