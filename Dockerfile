FROM node:20-slim
USER 1000
ENV HOME=/home/node
WORKDIR /home/node/app
COPY --chown=1000 . /home/node/app
RUN npm install
EXPOSE 7860
CMD ["node", "server.js"]
