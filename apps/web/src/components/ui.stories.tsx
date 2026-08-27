import type { Meta, StoryObj } from "@storybook/react";
import { Button, EmptyState, Skeleton, Stepper } from "./ui";
const meta: Meta = { title: "Design System/ui" };
export default meta;
export const Buttons: StoryObj = { render: () => <div className="flex gap-2"><Button>Primary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button loading>Loading</Button></div> };
export const Skeletons: StoryObj = { render: () => <div className="space-y-2"><Skeleton className="h-6 w-32" /><Skeleton className="h-20 w-full" /></div> };
export const Steppers: StoryObj = { render: () => <Stepper steps={[{label:"Cart",state:"done"},{label:"Address",state:"current"},{label:"Pay",state:"todo"}]} /> };
export const Empty: StoryObj = { render: () => <EmptyState title="No farms yet" description="Add your first farm to get started." /> };
