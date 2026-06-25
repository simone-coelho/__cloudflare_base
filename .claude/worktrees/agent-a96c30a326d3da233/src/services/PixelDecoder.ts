export interface PixelData {
  campaignId?: string;
  emailId?: string;
  recipientId?: string;
  metadata?: Record<string, any>;
  timestamp?: number;
}

export class PixelDecoder {
  private static readonly SEPARATOR = '.';
  private static readonly VERSION = 'v1';

  encode(data: PixelData): string {
    try {
      const payload = {
        v: PixelDecoder.VERSION,
        c: data.campaignId,
        e: data.emailId,
        r: data.recipientId,
        t: data.timestamp || Date.now(),
        m: data.metadata,
      };

      const jsonString = JSON.stringify(payload);
      const base64 = btoa(jsonString);
      
      const hash = this.generateHash(base64);
      
      return `${base64}${PixelDecoder.SEPARATOR}${hash}`;
    } catch (error) {
      throw new Error(`Failed to encode pixel data: ${error}`);
    }
  }

  decode(pixelId: string): PixelData {
    try {
      const parts = pixelId.split(PixelDecoder.SEPARATOR);
      if (parts.length !== 2) {
        throw new Error('Invalid pixel format');
      }

      const [base64Data, hash] = parts;
      
      const expectedHash = this.generateHash(base64Data);
      if (hash !== expectedHash) {
        throw new Error('Invalid pixel signature');
      }

      const jsonString = atob(base64Data);
      const payload = JSON.parse(jsonString);

      if (payload.v !== PixelDecoder.VERSION) {
        throw new Error('Unsupported pixel version');
      }

      return {
        campaignId: payload.c,
        emailId: payload.e,
        recipientId: payload.r,
        timestamp: payload.t,
        metadata: payload.m,
      };
    } catch (error) {
      throw new Error(`Failed to decode pixel: ${error}`);
    }
  }

  private generateHash(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).substring(0, 8);
  }

  validatePixel(pixelId: string): boolean {
    try {
      this.decode(pixelId);
      return true;
    } catch {
      return false;
    }
  }

  extractMetadata(pixelId: string): Record<string, any> {
    try {
      const data = this.decode(pixelId);
      return {
        campaignId: data.campaignId,
        emailId: data.emailId,
        recipientId: data.recipientId,
        timestamp: data.timestamp,
        age: data.timestamp ? Date.now() - data.timestamp : 0,
        ...data.metadata,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}