export const MENU_VERSION = "4";

const menu = [
  {
    category: "Entrees",
    items: [
      { id: 1, name: "Salade Caesar", price: 8.5, category: "Entrees" },
      { id: 2, name: "Soupe a l'oignon", price: 7.0, category: "Entrees" },
      { id: 3, name: "Bruschetta", price: 6.5, category: "Entrees" },
      { id: 4, name: "Assiette de charcuterie", price: 12.0, category: "Entrees" },
    ],
  },
  {
    category: "Plats",
    items: [
      { id: 5, name: "Poulet roti", price: 15.0, category: "Plats", subcategory: "Poulet" },
      { id: 6, name: "Poulet tikka masala", price: 16.0, category: "Plats", subcategory: "Poulet" },
      { id: 7, name: "Saumon grille", price: 19.5, category: "Plats", subcategory: "Poisson" },
      { id: 8, name: "Crevettes masala", price: 18.0, category: "Plats", subcategory: "Poisson" },
      { id: 9, name: "Steak frites", price: 18.0, category: "Plats", subcategory: "Boeuf" },
      { id: 33, name: "Burger maison", price: 16.0, category: "Plats", subcategory: "Boeuf" },
      { id: 34, name: "Agneau rogan josh", price: 18.0, category: "Plats", subcategory: "Agneau" },
      { id: 35, name: "Agneau saag", price: 17.0, category: "Plats", subcategory: "Agneau" },
      { id: 36, name: "Risotto aux champignons", price: 14.0, category: "Plats", subcategory: "Vegetarien" },
    ],
  },
  {
    category: "Desserts",
    items: [
      { id: 10, name: "Creme brulee", price: 7.5, category: "Desserts" },
      { id: 11, name: "Mousse au chocolat", price: 6.5, category: "Desserts" },
      { id: 12, name: "Tarte tatin", price: 8.0, category: "Desserts" },
      { id: 13, name: "Tiramisu", price: 7.0, category: "Desserts" },
    ],
  },
  {
    category: "Pains",
    items: [
      { id: 19, name: "Naan nature", price: 2.5, category: "Pains" },
      { id: 20, name: "Naan fromage", price: 3.5, category: "Pains" },
      { id: 21, name: "Naan ail", price: 3.0, category: "Pains" },
      { id: 22, name: "Chapati", price: 2.0, category: "Pains" },
      { id: 23, name: "Paratha", price: 3.0, category: "Pains" },
    ],
  },
  {
    category: "Formules",
    items: [
      { id: 29, name: "Formule entree + plat", price: 18.0, category: "Formules" },
      { id: 30, name: "Formule plat + dessert", price: 17.0, category: "Formules" },
      { id: 31, name: "Formule entree + plat + dessert", price: 22.0, category: "Formules" },
      { id: 32, name: "Formule midi", price: 14.0, category: "Formules" },
    ],
  },
  {
    category: "Extras",
    items: [
      { id: 24, name: "Supplement sauce", price: 1.0, category: "Extras" },
      { id: 25, name: "Fromage supplementaire", price: 1.5, category: "Extras" },
      { id: 26, name: "Riz basmati", price: 2.5, category: "Extras" },
      { id: 27, name: "Salade verte", price: 3.0, category: "Extras" },
      { id: 28, name: "Pain naan extra", price: 2.0, category: "Extras" },
    ],
  },
  {
    category: "Boissons",
    items: [
      { id: 14, name: "Eau minerale", price: 3.0, category: "Boissons" },
      { id: 15, name: "Coca-Cola", price: 3.5, category: "Boissons" },
      { id: 16, name: "Verre de vin rouge", price: 5.5, category: "Boissons" },
      { id: 17, name: "Cafe", price: 2.5, category: "Boissons" },
      { id: 18, name: "Biere pression", price: 5.0, category: "Boissons" },
    ],
  },
];

export default menu;
