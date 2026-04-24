import { listSponsors } from "@/lib/server/sponsors-service";

export const revalidate = 600;

export async function GET() {
  try {
    const sponsors = await listSponsors();
    return Response.json({ sponsors });
  } catch (error) {
    console.error("Failed to fetch sponsors:", error);
    return Response.json({ sponsors: [] }, { status: 500 });
  }
}
