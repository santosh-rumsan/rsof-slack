import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const auth: string = request.headers['authorization'] || '';

    if (!auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const token = auth.slice(7);
    const payload = this.verifyJwt(token);

    if (!payload) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Token missing sub claim');
    }

    request.jwtPayload = payload;
    return true;
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
