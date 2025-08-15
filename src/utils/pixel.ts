import { PixelDecoder, type PixelData } from '@/services/PixelDecoder';

export function generateEmailPixel(data: PixelData): string {
  const decoder = new PixelDecoder();
  return decoder.encode(data);
}

export function generatePixelUrl(baseUrl: string, pixelData: PixelData): string {
  const pixelId = generateEmailPixel(pixelData);
  return `${baseUrl}/pixel/track/${pixelId}`;
}

export function generatePixelHTML(pixelUrl: string, options?: {
  width?: number;
  height?: number;
  alt?: string;
  style?: string;
}): string {
  const {
    width = 1,
    height = 1,
    alt = '',
    style = 'display:none;border:0;'
  } = options || {};

  return `<img src="${pixelUrl}" width="${width}" height="${height}" alt="${alt}" style="${style}" />`;
}

export function generateAMPPixel(pixelUrl: string): string {
  return `<amp-pixel src="${pixelUrl}" layout="nodisplay"></amp-pixel>`;
}

export function generateEmailTemplate(content: string, pixelData: PixelData, baseUrl: string): string {
  const pixelUrl = generatePixelUrl(baseUrl, pixelData);
  const pixelHTML = generatePixelHTML(pixelUrl);
  
  return `${content}\n${pixelHTML}`;
}

export function parsePixelFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    
    if (pathParts.includes('pixel') && pathParts.includes('track')) {
      const pixelIndex = pathParts.findIndex(part => part === 'track');
      return pathParts[pixelIndex + 1] || null;
    }
    
    return null;
  } catch {
    return null;
  }
}

export function generateBatchPixels(
  campaigns: Array<{ id: string; emailId: string; recipientId: string; metadata?: any }>
): Array<{ campaignId: string; pixelId: string; pixelUrl: string; pixelHTML: string }> {
  const decoder = new PixelDecoder();
  
  return campaigns.map(campaign => {
    const pixelData: PixelData = {
      campaignId: campaign.id,
      emailId: campaign.emailId,
      recipientId: campaign.recipientId,
      metadata: campaign.metadata,
      timestamp: Date.now(),
    };
    
    const pixelId = decoder.encode(pixelData);
    const pixelUrl = `#BASEURL#/pixel/track/${pixelId}`;
    const pixelHTML = generatePixelHTML(pixelUrl);
    
    return {
      campaignId: campaign.id,
      pixelId,
      pixelUrl,
      pixelHTML,
    };
  });
}

export function validatePixelIntegrity(pixelId: string): boolean {
  try {
    const decoder = new PixelDecoder();
    return decoder.validatePixel(pixelId);
  } catch {
    return false;
  }
}

export function extractPixelMetadata(pixelId: string): Record<string, any> {
  try {
    const decoder = new PixelDecoder();
    return decoder.extractMetadata(pixelId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function generateUTMPixel(
  basePixelData: PixelData,
  utmParams: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  }
): PixelData {
  return {
    ...basePixelData,
    metadata: {
      ...basePixelData.metadata,
      utm_source: utmParams.source,
      utm_medium: utmParams.medium,
      utm_campaign: utmParams.campaign,
      utm_term: utmParams.term,
      utm_content: utmParams.content,
    },
  };
}

export function isPixelExpired(
  pixelId: string,
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000
): boolean {
  try {
    const decoder = new PixelDecoder();
    const data = decoder.decode(pixelId);
    
    if (!data.timestamp) return false;
    
    const age = Date.now() - data.timestamp;
    return age > maxAgeMs;
  } catch {
    return true;
  }
}