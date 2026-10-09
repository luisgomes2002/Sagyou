# Padrão visual do Sagyou

Use este padrão ao criar ou alterar cartões, botões, tags, banners e estados selecionados no renderer. A referência aprovada é a tela de Análises financeiras (`components/financial/AnalyticsTab.tsx`), alinhada aos cartões de Início, Finanças e Relatórios.

- **Superfícies:** fundo principal `#0b0b0f`, próximo ao fundo da tela de boas-vindas `#050507`; sidebar e colunas `#121216`, cartões, painéis e modais `#16161a`, campos internos `#101014`, hover de cartões `#222227`, borda `#2b2b31`. Use cores sólidas; estados selecionados podem usar `#2a2a30` e hover `#303036`.
- **Hierarquia:** rótulos discretos (`#999999`), texto principal claro (`#d4d4d4`) e cor de destaque no valor, ícone ou pequeno indicador. Verde `#46d478`/`#20b858`, vermelho `#ec6a6a`/`#e04040`, roxo `#a080f0`; escolha a cor pelo significado. Não pinte o cartão inteiro nem crie faixas coloridas no topo ou na lateral.
- **Tags e botões secundários:** fundo sólido neutro (`#16161a` ou `#2a2a30`), texto claro ou da cor semântica. Botões de criar/adicionar, inclusive em barras laterais, devem ter esse fundo já no estado normal; use a cor de destaque apenas no ícone pequeno. Hover visível em outro tom sólido. Botões primários podem usar uma cor sólida da ação com texto de alto contraste.
- **Banners e avisos:** superfície escura sólida, texto ou ícone semântico e borda neutra. Evite `bg-[#cor]/5`, `/10`, `/15`, `/20` e similares, bem como texto colorido com opacidade reduzida: o resultado fica apagado sobre o tema escuro.
- **Transparência funcional:** mantenha opacidade em scrims de modais, visualização de imagens, estados desabilitados, efeitos de arrastar e elementos que aparecem no hover. Ela serve à interação, não ao preenchimento decorativo de cartões, botões ou tags.

Exemplo para um indicador:

```tsx
<div className="rounded-lg bg-[#16161a] border border-[#2b2b31] p-3">
  <p className="text-[10px] text-[#999999] mb-1">Entradas</p>
  <p className="text-sm font-bold text-[#46d478] tabular-nums">R$ 1.234,56</p>
</div>
```
