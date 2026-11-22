export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return Response.json(
    {
      name: "Door Scanner",
      short_name: "Door",
      start_url: `/door/${code}/scan`,
      scope: `/door/${code}/`,
      display: "standalone",
      orientation: "portrait",
      background_color: "#000000",
      theme_color: "#000000",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
