import { getAdminKey, getAppBaseUrl, getSupabaseConfig } from "@/lib/backend-config";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(getSupabaseConfig());
  return json({
    mode: configured ? "backend-configured" : "local-demo",
    supabaseConfigured: configured,
    privateStorageAdminConfigured: Boolean(getAdminKey()),
    appBaseUrlConfigured: Boolean(getAppBaseUrl()),
    ocrConfigured: Boolean(process.env.OCR_PROVIDER_ENDPOINT && process.env.OCR_PROVIDER_API_KEY),
    reminderDeliveryConfigured: false,
  });
}
