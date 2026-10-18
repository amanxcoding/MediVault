import { createSupabaseServerClient } from "@/lib/supabase/server";
import { errorResponse, json, requireSameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error("signout failed");
    }
    return json({ signedOut: true });
  } catch (error) {
    return errorResponse(error);
  }
}
