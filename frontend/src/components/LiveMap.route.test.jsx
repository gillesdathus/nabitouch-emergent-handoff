import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { LiveMap } from "@/components/LiveMap";

test("SimulatedMap draws multi-segment road polyline not a single crow-flies chord", async () => {
  const road = [
    { lat: 53.5461, lng: -113.4938 },
    { lat: 53.5461, lng: -113.4901 },
    { lat: 53.5498, lng: -113.4901 },
    { lat: 53.5498, lng: -113.4855 },
    { lat: 53.5532, lng: -113.4855 },
    { lat: 53.5532, lng: -113.4802 },
  ];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(LiveMap, {
      localOnly: true,
      routes: [road],
      dests: [
        { pos: road[0], label: "1" },
        { pos: road[road.length - 1], label: "2" },
      ],
      height: 320,
      testid: "route-map",
      tag: "Road route",
    }));
  });
  const paths = [...host.querySelectorAll("path")].map((node) => node.getAttribute("d") || "");
  const routePath = paths.find((d) => (d.match(/L/g) || []).length >= 4);
  expect(routePath).toBeTruthy();
  expect((routePath.match(/L/g) || []).length).toBeGreaterThanOrEqual(4);
  // Crow-flies would be a single L between ends; road fixture has stair-step segments.
  expect(routePath.startsWith("M")).toBe(true);
  act(() => root.unmount());
  host.remove();
});
