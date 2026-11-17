"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { finalizePhotoAction, requestPhotoUploadAction } from "@/app/actions/cleaner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/config";
import type { PhotoKind } from "@/lib/contracts/domain";

type Phase = { name: "idle" } | { name: "uploading"; percent: number } | { name: "processing" };

/** PUTs the file to the presigned URL; fetch() can't report upload progress, XHR can. */
function putWithProgress(url: string, file: File, contentType: string, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}

/**
 * Opens the phone's rear camera (or the file picker on a laptop) and uploads the
 * photo straight to storage: presigned URL → PUT → finalize on the server.
 */
export function PhotoCapture({
  jobId,
  kind,
  label,
  variant = "default",
}: {
  jobId: string;
  kind: PhotoKind;
  label: string;
  variant?: "default" | "outline";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const busy = phase.name !== "idle";

  async function upload(file: File) {
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      toast.error("Use a JPEG, PNG or WebP photo.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Photos must be under 15 MB.");
      return;
    }
    setPhase({ name: "uploading", percent: 0 });
    try {
      const ticket = await requestPhotoUploadAction({ jobId, kind, contentType: file.type, size: file.size });
      if (!ticket.ok) throw new Error(ticket.error);
      const { key, url, contentType } = ticket.data!;
      await putWithProgress(url, file, contentType, (percent) => setPhase({ name: "uploading", percent }));
      setPhase({ name: "processing" });
      const result = await finalizePhotoAction({ jobId, kind, key });
      if (!result.ok) throw new Error(result.error);
      if (result.data?.flagged) toast.warning(result.message);
      else toast.success(result.message ?? "Photo saved.");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "The upload failed. Please try again.");
    } finally {
      setPhase({ name: "idle" });
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <input
        ref={input}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button type="button" size="xl" variant={variant} className="w-full" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />}
        {phase.name === "uploading" ? `Uploading… ${phase.percent}%` : phase.name === "processing" ? "Saving photo…" : label}
      </Button>
      {phase.name === "uploading" && <Progress value={phase.percent} aria-label="Upload progress" />}
    </div>
  );
}
