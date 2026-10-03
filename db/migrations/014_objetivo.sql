-- Objetivo principal da pessoa (escolhido no Coach): personaliza a jornada e o foco.
ALTER TABLE app.subscribers ADD COLUMN objective text CHECK (objective IN ('organizar','sair_do_vermelho','reserva','investir'));
