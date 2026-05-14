import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import * as crypto from 'crypto';

/**
 * Accepts either:
 *   1. A valid X-API-Key header matching the API_KEY setting (DB or env), OR
 *   2. A valid RS256 Bearer JWT whose `roles` array contains `{APP_ID}|admin`
 *
 * Both paths require the respective env vars / settings to be set.
 */
@Injectable()
export class ApiKeyOrJwtAdminGuard implements CanActivate {
  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // ── 1. Try API key (DB wins, falls back to env) ───────────────────────────
    const apiKey: string = request.headers['x-api-key'] ?? '';
    const expectedKey = this.settings.get('API_KEY', this.config.get<string>('API_KEY', ''));
    if (apiKey && expectedKey && apiKey === expectedKey) {
      return true;
    }

    // ── 2. Try JWT with admin role ────────────────────────────────────────────
    const auth: string = request.headers['authorization'] ?? '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      const payload = this.verifyJwt(token);

      if (!payload) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      if (!payload.sub) {
        throw new UnauthorizedException('Token missing sub claim');
      }

      const appId = this.config.get<string>('APP_ID', '');
      const roles: string[] = Array.isArray(payload.roles) ? payload.roles : [];

      const hasAdminRole = roles.some((r) => {
        const [roleAppId, rolePart] = r.split('|');
        return roleAppId === appId && rolePart?.split(',').includes('admin');
      });

      if (!appId || !hasAdminRole) {
        throw new UnauthorizedException('Insufficient permissions');
      }

      request.jwtPayload = payload;
      return true;
    }

    throw new UnauthorizedException('Invalid or missing API key');
  }

  private verifyJwt(token: string): Record<string, any> | null {
    const pem = this.config.get<string>('JWT_PUBLIC_KEY_PEM', '');
    if (!pem) return null;

    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const header = JSON.parse(this.b64urlDecode(parts[0]).toString());
      if (header.alg !== 'RS256') return null;

      const payload = JSON.parse(this.b64urlDecode(parts[1]).toString());

      const signature = this.b64urlDecode(parts[2]);
      const message = Buffer.from(`${parts[0]}.${parts[1]}`);
      const publicKey = pem.replace(/\\n/g, '\n');

      const verify = crypto.createVerify('SHA256');
      verify.update(message);
      if (!verify.verify(publicKey, signature)) return null;

      if ((payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;

      return payload;
    } catch {
      return null;
    }
  }

  private b64urlDecode(s: string): Buffer {
    const padded = s + '='.repeat((-s.length) & 3);
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }
}
