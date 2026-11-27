"use client";

type CleanGetFormProps = {
  action: string;
  className?: string;
  children: React.ReactNode;
  omitValues?: Record<string, string>;
};

const isCheckable = (field: HTMLInputElement | HTMLSelectElement): field is HTMLInputElement => {
  if (!(field instanceof HTMLInputElement)) {
    return false;
  }
  return field.type === "checkbox" || field.type === "radio";
};

const shouldOmit = (field: HTMLInputElement | HTMLSelectElement, omitValues?: Record<string, string>) => {
  if (isCheckable(field)) {
    return false;
  }
  const value = field.value.trim();
  if (!value) {
    return true;
  }
  if (!omitValues) {
    return false;
  }
  return omitValues[field.name] === value;
};

export const CleanGetForm = ({ action, className, children, omitValues }: CleanGetFormProps) => {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const params = new URLSearchParams();
    const fields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name]");
    for (const field of fields) {
      if (field.disabled || shouldOmit(field, omitValues)) {
        continue;
      }
      if (isCheckable(field) && !field.checked) {
        continue;
      }
      params.append(field.name, field.value);
    }
    const query = params.toString();
    const target = query ? `${form.action}?${query}` : form.action;
    window.location.assign(target);
  };

  return (
    <form action={action} method="get" className={className} onSubmit={handleSubmit}>
      {children}
    </form>
  );
};
