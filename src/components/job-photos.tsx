"use client";

import { useState } from "react";
import Image from "next/image";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deletePhotoAction } from "@/app/actions/cleaner";
import type { PhotoKind } from "@/lib/contracts/domain";
import { formatDateTime } from "@/lib/format";
import type { JobPhotoView } from "@/lib/photo-rules";
import { ActionButton } from "./forms";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

const KIND_LABEL: Record<PhotoKind, string> = { BEFORE: "Before", AFTER: "After" };

function captureText(photo: JobPhotoView): string {
  return photo.takenAt ? `Taken ${formatDateTime(photo.takenAt)}` : `Uploaded ${formatDateTime(photo.createdAt)}`;
}

/**
 * Before and after photos side by side; tap one to see it full size.
 * `showFlags` reveals the controller's suspicious-photo notes; `deletableKind` lets
 * the assigned cleaner remove photos from the step they are on.
 */
export function JobPhotos({
  photos,
  showFlags = false,
  deletableKind = null,
  emptyText = "No photos yet.",
}: {
  photos: JobPhotoView[];
  showFlags?: boolean;
  deletableKind?: PhotoKind | null;
  emptyText?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = photos.find((p) => p.id === openId) ?? null;

  if (photos.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {(["BEFORE", "AFTER"] as const).map((kind) => {
          const list = photos.filter((p) => p.kind === kind);
          return (
            <section key={kind} className="grid content-start gap-2" aria-label={`${KIND_LABEL[kind]} photos`}>
              <h3 className="text-sm font-medium">{KIND_LABEL[kind]}</h3>
              {list.length === 0 ? (
                <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                  Not yet
                </div>
              ) : (
                list.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setOpenId(photo.id)}
                    className="group relative overflow-hidden rounded-lg border text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    aria-label={`${KIND_LABEL[kind]} photo, ${captureText(photo)}. Open full size`}
                  >
                    <Image
                      src={photo.thumbUrl}
                      alt=""
                      width={photo.width}
                      height={photo.height}
                      unoptimized
                      className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                    <span className="block bg-background/90 px-2 py-1 text-[11px] text-muted-foreground">{captureText(photo)}</span>
                    {showFlags && photo.flagged && (
                      <Badge variant="warning" className="absolute top-1.5 left-1.5">
                        <AlertTriangle aria-hidden /> Flagged
                      </Badge>
                    )}
                  </button>
                ))
              )}
            </section>
          );
        })}
      </div>

      <Dialog open={open !== null} onOpenChange={(value) => !value && setOpenId(null)}>
        {open && (
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{KIND_LABEL[open.kind]} photo</DialogTitle>
              <DialogDescription>{captureText(open)}</DialogDescription>
            </DialogHeader>
            <Image
              src={open.displayUrl}
              alt={`${KIND_LABEL[open.kind]} photo of the driveway`}
              width={open.width}
              height={open.height}
              unoptimized
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
            {showFlags && open.flagReason && (
              <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" aria-hidden /> {open.flagReason}
              </p>
            )}
            {deletableKind === open.kind && (
              <ActionButton
                action={async () => {
                  const result = await deletePhotoAction(open.id);
                  if (result.ok) setOpenId(null);
                  return result;
                }}
                variant="outline"
                size="lg"
                className="w-full sm:w-fit"
              >
                <Trash2 aria-hidden /> Remove this photo
              </ActionButton>
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
