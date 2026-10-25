import { fieldClass, labelClass } from "../../components/styles";
import type { Category } from "../../stores/products-store";

const INDENT = "   ";

/** Choix de la catégorie d'un lot. L'arbre est rendu par indentation. */
export function CategorySelect({
  categories,
  value,
  onChange,
  disabled = false,
}: {
  categories: Category[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className={labelClass}>
      Catégorie
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        className={fieldClass}
      >
        <option value="">Sans catégorie</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {INDENT.repeat(category.depth)}
            {category.name}
          </option>
        ))}
      </select>
      {categories.length === 0 && (
        <span className="mt-1 block text-[12px] font-normal text-fg-faint">
          Créez des catégories depuis la liste des produits (« Gérer »).
        </span>
      )}
    </label>
  );
}
