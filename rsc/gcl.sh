#!/bin/bash

# frontpage
git clone git@github.com:diegonmarcos/diegonmarcos.git profile
git -C profile pull
# dev
git clone git@github.com:diegonmarcos/dev.git
git -C dev pull
# sys
git clone git@github.com:diegonmarcos/system.git ||true
git -C system pull
# algo
git clone git@github.com:diegonmarcos/algo.git
git -C algo pull
# graphic
git clone git@github.com:diegonmarcos/graphic.git
git -C graphic pull
# mylib
git clone git@github.com:diegonmarcos/mylib.git
git -C mylib pull
# front
git clone git@github.com:diegonmarcos/front.git
git -C front pull
# website
git clone git@github.com:diegonmarcos/diegonmarcos.github.io.git website
git -C website pull