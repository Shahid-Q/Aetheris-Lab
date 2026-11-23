import { useId, type ReactNode } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import { useText } from "./text";
export function Icon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={"material-symbols-rounded " + className}
    >
      {name}
    </span>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useText();
  const titleId = useId();
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={onClose}
      aria-labelledby={titleId}
    >
      <DialogTitle component="div" className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <IconButton onClick={onClose} aria-label={t("close")}>
          <Icon name="close" />
        </IconButton>
      </DialogTitle>
      <DialogContent className="dialog-body">{children}</DialogContent>
    </Dialog>
  );
}
export function Notice({
  children,
  kind = "info",
}: {
  children: ReactNode;
  kind?: "info" | "warning" | "error";
}) {
  return (
    <div
      className={"notice " + kind}
      role={kind === "error" ? "alert" : undefined}
    >
      <Icon
        name={
          kind === "error"
            ? "error"
            : kind === "warning"
              ? "verified_user"
              : "info"
        }
      />
      <div>{children}</div>
    </div>
  );
}
