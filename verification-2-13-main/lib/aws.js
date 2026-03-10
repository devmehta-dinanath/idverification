import { S3Client } from "@aws-sdk/client-s3";
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { TextractClient, AnalyzeIDCommand } from "@aws-sdk/client-textract";
import { parseAnalyzeIdFields } from "./id-parser";

// Support different regions for different services
// S3 can be in ap-southeast-7 (Thailand), but Rekognition/Textract need ap-southeast-1 (Singapore)
const AWS_REGION = process.env.AWS_REGION || "ap-southeast-1";
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || "ap-southeast-7"; // S3 bucket location
const REKOGNITION_REGION = process.env.REKOGNITION_REGION || "ap-southeast-1"; // Rekognition available here
const TEXTRACT_REGION = process.env.TEXTRACT_REGION || "ap-southeast-1"; // Textract available here

export const BUCKET = process.env.S3_BUCKET_NAME;

// Get credentials from environment
const getAwsConfig = (region) => {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    
    const config = { region };
    
    // Explicitly pass credentials if available
    if (accessKeyId && secretAccessKey) {
        config.credentials = {
            accessKeyId,
            secretAccessKey,
        };
    }
    
    return config;
};

export const s3 = new S3Client(getAwsConfig(S3_REGION));
export const rekognition = new RekognitionClient(getAwsConfig(REKOGNITION_REGION));
export const textract = new TextractClient(getAwsConfig(TEXTRACT_REGION));

export async function runTextractAnalyzeIdWithTimeout(imageBuffer, timeoutMs = 15000) {
    const run = async () => {
        console.log(`[textract] Sending AnalyzeID request (image size: ${(imageBuffer.length / 1024).toFixed(2)}KB)...`);
        const res = await textract.send(
            new AnalyzeIDCommand({
                DocumentPages: [{ Bytes: imageBuffer }],
            })
        );
        
        // Log raw response for debugging
        const identityDoc = res?.IdentityDocuments?.[0];
        const fields = identityDoc?.IdentityDocumentFields || [];
        console.log(`[textract] Received ${fields.length} fields from Textract`);
        
        // Log all detected fields with confidence scores
        if (fields.length > 0) {
            console.log(`[textract] Raw fields detected:`);
            fields.forEach(f => {
                const type = f?.Type?.Text || 'unknown';
                const value = f?.ValueDetection?.Text || '';
                const confidence = f?.ValueDetection?.Confidence || 0;
                const normalizedValue = f?.ValueDetection?.NormalizedValue;
                console.log(`  - ${type}: "${value}" (confidence: ${confidence.toFixed(1)}%)${normalizedValue ? ` [normalized: ${JSON.stringify(normalizedValue)}]` : ''}`);
            });
        }
        
        return parseAnalyzeIdFields(fields);
    };

    try {
        const data = await Promise.race([
            run(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Textract timeout after ${timeoutMs}ms`)), timeoutMs)
            ),
        ]);
        console.log(`[textract] ✅ Successfully parsed ${Object.keys(data || {}).length} fields`);
        return { ok: true, data };
    } catch (e) {
        console.error(`[textract] ❌ Error:`, e?.message || String(e));
        return { ok: false, error: e?.message || String(e) };
    }
}
