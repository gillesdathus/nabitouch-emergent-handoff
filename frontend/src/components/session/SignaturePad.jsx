import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

export function SignaturePad({ onChange, testid = "signature-pad" }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const points = useRef(0);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const el = canvas.current;
    const ratio = window.devicePixelRatio || 1;
    el.width = el.offsetWidth * ratio;
    el.height = el.offsetHeight * ratio;
    const ctx = el.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0B2545";
  }, []);

  const at = (event) => {
    const box = canvas.current.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };
  const down = (event) => {
    event.preventDefault();
    canvas.current.setPointerCapture?.(event.pointerId);
    drawing.current = true;
    const ctx = canvas.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(...at(event));
  };
  const move = (event) => {
    if (!drawing.current) return;
    const ctx = canvas.current.getContext("2d");
    ctx.lineTo(...at(event));
    ctx.stroke();
    points.current += 1;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (points.current > 12) {
      setEmpty(false);
      onChange(canvas.current.toDataURL("image/png"));
    }
  };
  const clear = () => {
    const el = canvas.current;
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    points.current = 0;
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-2xl bg-white ring-1 ring-sky-200">
        <canvas ref={canvas} data-testid={testid} className="h-40 w-full touch-none cursor-crosshair" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-nb-mute">Sign here with your finger or mouse</span>}
        <span className="pointer-events-none absolute bottom-3 left-4 right-4 border-b border-dashed border-sky-200" />
      </div>
      <button type="button" onClick={clear} data-testid={`${testid}-clear`} className="inline-flex items-center gap-1 text-xs font-medium text-nb-mute hover:text-nb-blue"><Eraser className="h-3.5 w-3.5" />Clear signature</button>
    </div>
  );
}
