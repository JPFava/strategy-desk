import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/desk/gate";

export const Route = createFileRoute("/")({
  component: Gate,
});
